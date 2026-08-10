// /api/data/service-log
// GET ?machineId=   -> { log: [...] }  (all machines if omitted, newest first)
// POST { machineId, servicedAt, servicedBy, notes }
// DELETE ?id=...
//
// Requires a D1 database bound as "DB". Sits behind Cloudflare Access.

function genId() {
  return crypto.randomUUID();
}
function isMissingTableError(err) {
  return /no such table/i.test(String(err && err.message || err));
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const machineId = url.searchParams.get('machineId');
  try {
    let query = `SELECT id, machine_id as machineId, serviced_at as servicedAt, serviced_by as servicedBy, notes FROM service_log WHERE 1=1`;
    const binds = [];
    if (machineId) { binds.push(machineId); query += ` AND machine_id = ?${binds.length}`; }
    query += ' ORDER BY serviced_at DESC';
    const { results } = await env.DB.prepare(query).bind(...binds).all();
    return Response.json({ log: results });
  } catch (err) {
    if (isMissingTableError(err)) {
      return Response.json({ log: [], _migrationNeeded: 'migrations/004_orders_inventory_service.sql' });
    }
    return Response.json({ error: String(err.message || err) }, { status: 500 });
  }
}

export async function onRequestPost({ request, env }) {
  const body = await request.json();
  const { machineId, servicedAt, servicedBy = '', notes = '' } = body;
  if (!machineId || !servicedAt) {
    return Response.json({ error: 'machineId and servicedAt are required' }, { status: 400 });
  }
  try {
    const id = genId();
    await env.DB.prepare(
      `INSERT INTO service_log (id, machine_id, serviced_at, serviced_by, notes) VALUES (?1, ?2, ?3, ?4, ?5)`
    ).bind(id, machineId, servicedAt, servicedBy, notes).run();
    return Response.json({ id, machineId, servicedAt, servicedBy, notes });
  } catch (err) {
    if (isMissingTableError(err)) {
      return Response.json({
        error: 'The service_log table doesn\'t exist yet — run migrations/004_orders_inventory_service.sql against the D1 database, then try again.',
      }, { status: 500 });
    }
    return Response.json({ error: String(err.message || err) }, { status: 500 });
  }
}

export async function onRequestDelete({ request, env }) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return Response.json({ error: 'id query param required' }, { status: 400 });
  await env.DB.prepare('DELETE FROM service_log WHERE id = ?1').bind(id).run();
  return Response.json({ ok: true });
}
