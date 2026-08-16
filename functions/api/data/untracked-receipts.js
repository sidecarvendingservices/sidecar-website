// /api/data/untracked-receipts
// GET ?status=unmatched|matched   -> { receipts: [...] }  (all, if status omitted)
// POST (create) { r2Key, filename, contentType?, uploadedBy?, uploadedByEmail?, note? }
//   Records a receipt already uploaded to R2 (via /api/data/receipt-upload) and auto-creates
//   a task ("Log expense for receipt — <filename>", category 'auto-receipt') assigned to
//   uploadedBy, so it doesn't get lost.
// POST (match) { id, matchExpenseId }
//   Links the receipt to a real expense, marks it matched, and auto-completes its task.
// DELETE ?id=...  -> removes the receipt row, its R2 object, and completes its task
//   (used when a receipt turns out to be junk / a duplicate, not a real expense).
//
// Requires a D1 database bound as "DB" and (for delete) an R2 bucket bound as "RECEIPTS".
// Sits behind Cloudflare Access. Added via migrations/012_untracked_receipts.sql.

function genId(prefix) {
  return prefix + '_' + crypto.randomUUID();
}
function isMissingTableOrColumn(err) {
  return /no such (table|column)/i.test(String(err && err.message || err));
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const status = url.searchParams.get('status');
  try {
    let query = `SELECT id, r2_key as r2Key, filename, content_type as contentType, uploaded_by as uploadedBy,
                        uploaded_by_email as uploadedByEmail, note, status, matched_expense_id as matchedExpenseId,
                        task_id as taskId, created_at as createdAt, matched_at as matchedAt
                 FROM untracked_receipts WHERE 1=1`;
    const binds = [];
    if (status) { binds.push(status); query += ` AND status = ?${binds.length}`; }
    query += ' ORDER BY created_at DESC';
    const { results } = await env.DB.prepare(query).bind(...binds).all();
    return Response.json({ receipts: results });
  } catch (err) {
    if (isMissingTableOrColumn(err)) return Response.json({ receipts: [], _migrationNeeded: 'migrations/012_untracked_receipts.sql' });
    return Response.json({ error: String(err.message || err) }, { status: 500 });
  }
}

export async function onRequestPost({ request, env }) {
  const body = await request.json();

  // Match an existing receipt to a real expense.
  if (body.id && body.matchExpenseId) {
    try {
      const receipt = await env.DB.prepare('SELECT task_id FROM untracked_receipts WHERE id = ?1').bind(body.id).first();
      if (!receipt) return Response.json({ error: 'Receipt not found.' }, { status: 404 });
      const now = new Date().toISOString();
      await env.DB.prepare(
        `UPDATE untracked_receipts SET status = 'matched', matched_expense_id = ?2, matched_at = ?3 WHERE id = ?1`
      ).bind(body.id, body.matchExpenseId, now).run();
      if (receipt.task_id) {
        await env.DB.prepare(`UPDATE tasks SET status = 'complete', completed_at = ?2 WHERE id = ?1`).bind(receipt.task_id, now).run();
      }
      return Response.json({ ok: true });
    } catch (err) {
      if (isMissingTableOrColumn(err)) return Response.json({ error: 'Run migrations/012_untracked_receipts.sql, then try again.' }, { status: 500 });
      return Response.json({ error: String(err.message || err) }, { status: 500 });
    }
  }

  // Create a new untracked receipt record.
  const { r2Key, filename = '', contentType = '', uploadedBy = 'Unassigned', uploadedByEmail = '', note = '' } = body;
  if (!r2Key) return Response.json({ error: 'r2Key is required — upload the file via /api/data/receipt-upload first.' }, { status: 400 });

  try {
    const id = genId('receipt');
    const taskId = genId('task');
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO untracked_receipts (id, r2_key, filename, content_type, uploaded_by, uploaded_by_email, note, status, task_id, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'unmatched', ?8, ?9)`
    ).bind(id, r2Key, filename, contentType, uploadedBy, uploadedByEmail, note, taskId, now).run();

    await env.DB.prepare(
      `INSERT INTO tasks (id, title, description, owner, due_date, priority, status, category, recurring, property_id, machine_id, contact_id, created_at, completed_at)
       VALUES (?1, ?2, ?3, ?4, ?5, 'normal', 'to_do', 'auto-receipt', '', NULL, NULL, NULL, ?6, NULL)`
    ).bind(
      taskId, `Log expense for receipt${filename ? ' — ' + filename : ''}`,
      note || 'Uploaded via Quick Add → Upload Receipt. Match it to a real expense on the Untracked Receipts list — this task auto-completes once you do.',
      uploadedBy, new Date().toISOString().slice(0, 10), now,
    ).run();

    return Response.json({ id, r2Key, filename, contentType, uploadedBy, uploadedByEmail, note, status: 'unmatched', taskId, createdAt: now });
  } catch (err) {
    if (isMissingTableOrColumn(err)) return Response.json({ error: 'Run migrations/012_untracked_receipts.sql, then try again.' }, { status: 500 });
    return Response.json({ error: String(err.message || err) }, { status: 500 });
  }
}

export async function onRequestDelete({ request, env }) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return Response.json({ error: 'id query param required' }, { status: 400 });

  const receipt = await env.DB.prepare('SELECT r2_key, task_id FROM untracked_receipts WHERE id = ?1').bind(id).first();
  if (!receipt) return Response.json({ error: 'Receipt not found.' }, { status: 404 });

  if (receipt.task_id) {
    await env.DB.prepare(`UPDATE tasks SET status = 'complete', completed_at = ?2 WHERE id = ?1`).bind(receipt.task_id, new Date().toISOString()).run();
  }
  if (env.RECEIPTS && receipt.r2_key) {
    try { await env.RECEIPTS.delete(receipt.r2_key); } catch (e) { /* not fatal — the D1 row is the source of truth for the list */ }
  }
  await env.DB.prepare('DELETE FROM untracked_receipts WHERE id = ?1').bind(id).run();
  return Response.json({ ok: true });
}
