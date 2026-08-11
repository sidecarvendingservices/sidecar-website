// /api/data/activity
// GET ?propertyId=&limit=   -> { activity: [...] }  newest first (all properties if omitted)
// POST { propertyId, machineId?, contactId?, type, direction?, outcome?, summary, notes?,
//        followUpDate?, owner?, occurredAt? }
//   If followUpDate is set, a linked Task is auto-created (title derived from summary).
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
  const propertyId = url.searchParams.get('propertyId');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '200', 10) || 200, 1000);
  try {
    let query = `SELECT id, property_id as propertyId, machine_id as machineId, contact_id as contactId,
                        type, direction, outcome, summary, notes, follow_up_date as followUpDate,
                        owner, occurred_at as occurredAt, created_at as createdAt
                 FROM activity_log WHERE 1=1`;
    const binds = [];
    if (propertyId) { binds.push(propertyId); query += ` AND property_id = ?${binds.length}`; }
    query += ' ORDER BY occurred_at DESC';
    binds.push(limit);
    query += ` LIMIT ?${binds.length}`;
    const { results } = await env.DB.prepare(query).bind(...binds).all();
    return Response.json({ activity: results });
  } catch (err) {
    if (isMissingTableError(err)) {
      return Response.json({ activity: [], _migrationNeeded: 'migrations/005_properties_contacts_activity_tasks.sql' });
    }
    return Response.json({ error: String(err.message || err) }, { status: 500 });
  }
}

export async function onRequestPost({ request, env }) {
  const body = await request.json();
  const {
    propertyId, machineId = null, contactId = null, type, direction = null, outcome = null,
    summary, notes = '', followUpDate = null, owner = '', occurredAt,
  } = body;
  if (!propertyId || !type || !summary) {
    return Response.json({ error: 'propertyId, type, and summary are required' }, { status: 400 });
  }

  try {
    const id = genId('act');
    const now = new Date().toISOString();
    const when = occurredAt || now;
    await env.DB.prepare(
      `INSERT INTO activity_log (id, property_id, machine_id, contact_id, type, direction, outcome, summary, notes, follow_up_date, owner, occurred_at, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)`
    ).bind(id, propertyId, machineId, contactId, type, direction, outcome, summary, notes, followUpDate, owner, when, now).run();

    let taskId = null;
    if (followUpDate) {
      taskId = genId('task');
      await env.DB.prepare(
        `INSERT INTO tasks (id, title, description, owner, due_date, priority, status, category, property_id, machine_id, contact_id, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 'normal', 'to_do', 'follow_up', ?6, ?7, ?8, ?9)`
      ).bind(taskId, `Follow up: ${summary}`.slice(0, 200), notes, owner, followUpDate, propertyId, machineId, contactId, now).run();
    }

    return Response.json({ id, propertyId, machineId, contactId, type, direction, outcome, summary, notes, followUpDate, owner, occurredAt: when, taskId });
  } catch (err) {
    if (isMissingTableError(err)) {
      return Response.json({ error: 'The activity_log table doesn\'t exist yet — run migrations/005_properties_contacts_activity_tasks.sql, then try again.' }, { status: 500 });
    }
    return Response.json({ error: String(err.message || err) }, { status: 500 });
  }
}

export async function onRequestDelete({ request, env }) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return Response.json({ error: 'id query param required' }, { status: 400 });
  await env.DB.prepare('DELETE FROM activity_log WHERE id = ?1').bind(id).run();
  return Response.json({ ok: true });
}
