// /api/data/tasks
// GET ?status=&owner=&propertyId=&machineId=&dueBefore=   -> { tasks: [...] }
// POST { id?, title, description, owner, dueDate, priority, status, category, recurring,
//        propertyId, machineId, contactId }
// DELETE ?id=...
//
// Requires a D1 database bound as "DB". Sits behind Cloudflare Access.

function genId(prefix) {
  return prefix + '_' + crypto.randomUUID();
}
function isMissingTableError(err) {
  return /no such table/i.test(String(err && err.message || err));
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const status = url.searchParams.get('status');
  const owner = url.searchParams.get('owner');
  const propertyId = url.searchParams.get('propertyId');
  const machineId = url.searchParams.get('machineId');
  const dueBefore = url.searchParams.get('dueBefore');

  try {
    let query = `SELECT id, title, description, owner, due_date as dueDate, priority, status, category,
                        recurring, property_id as propertyId, machine_id as machineId, contact_id as contactId,
                        created_at as createdAt, completed_at as completedAt
                 FROM tasks WHERE 1=1`;
    const binds = [];
    if (status) { binds.push(status); query += ` AND status = ?${binds.length}`; }
    if (owner) { binds.push(owner); query += ` AND owner = ?${binds.length}`; }
    if (propertyId) { binds.push(propertyId); query += ` AND property_id = ?${binds.length}`; }
    if (machineId) { binds.push(machineId); query += ` AND machine_id = ?${binds.length}`; }
    if (dueBefore) { binds.push(dueBefore); query += ` AND due_date IS NOT NULL AND due_date <= ?${binds.length}`; }
    query += ` ORDER BY CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, due_date ASC`;
    const { results } = await env.DB.prepare(query).bind(...binds).all();
    return Response.json({ tasks: results });
  } catch (err) {
    if (isMissingTableError(err)) {
      return Response.json({ tasks: [], _migrationNeeded: 'migrations/005_properties_contacts_activity_tasks.sql' });
    }
    return Response.json({ error: String(err.message || err) }, { status: 500 });
  }
}

export async function onRequestPost({ request, env }) {
  const body = await request.json();
  const {
    title, description = '', owner = 'Unassigned', dueDate = null, priority = 'normal',
    status = 'to_do', category = '', recurring = '', propertyId = null, machineId = null, contactId = null,
  } = body;
  if (!title) return Response.json({ error: 'title is required' }, { status: 400 });

  try {
    const now = new Date().toISOString();
    const completedAt = status === 'complete' ? now : null;

    if (body.id) {
      const existing = await env.DB.prepare('SELECT id, status FROM tasks WHERE id = ?1').bind(body.id).first();
      if (existing) {
        const newCompletedAt = status === 'complete'
          ? (existing.status === 'complete' ? undefined : now)
          : null;
        await env.DB.prepare(
          `UPDATE tasks SET title=?2, description=?3, owner=?4, due_date=?5, priority=?6, status=?7,
             category=?8, recurring=?9, property_id=?10, machine_id=?11, contact_id=?12,
             completed_at = COALESCE(?13, completed_at)
           WHERE id=?1`
        ).bind(body.id, title, description, owner, dueDate, priority, status, category, recurring, propertyId, machineId, contactId, newCompletedAt === undefined ? null : newCompletedAt).run();
        if (status !== 'complete') {
          await env.DB.prepare('UPDATE tasks SET completed_at = NULL WHERE id = ?1 AND status != \'complete\'').bind(body.id).run();
        }
        return Response.json({ id: body.id, title, description, owner, dueDate, priority, status, category, recurring, propertyId, machineId, contactId });
      }
    }
    const id = body.id || genId('task');
    await env.DB.prepare(
      `INSERT INTO tasks (id, title, description, owner, due_date, priority, status, category, recurring, property_id, machine_id, contact_id, created_at, completed_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`
    ).bind(id, title, description, owner, dueDate, priority, status, category, recurring, propertyId, machineId, contactId, now, completedAt).run();
    return Response.json({ id, title, description, owner, dueDate, priority, status, category, recurring, propertyId, machineId, contactId, createdAt: now });
  } catch (err) {
    if (isMissingTableError(err)) {
      return Response.json({ error: 'The tasks table doesn\'t exist yet — run migrations/005_properties_contacts_activity_tasks.sql, then try again.' }, { status: 500 });
    }
    return Response.json({ error: String(err.message || err) }, { status: 500 });
  }
}

export async function onRequestDelete({ request, env }) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return Response.json({ error: 'id query param required' }, { status: 400 });
  await env.DB.prepare('DELETE FROM tasks WHERE id = ?1').bind(id).run();
  return Response.json({ ok: true });
}
