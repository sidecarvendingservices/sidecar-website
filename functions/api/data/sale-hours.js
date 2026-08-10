// /api/data/sale-hours
// GET ?start=&end=&machineId=   -> { hours: [{ machineId, date, hour, gross, source }, ...] }
// POST (sync, bulk idempotent replace): {
//   sync: true, machineId, start, end,
//   entries: [ { date, hour, gross }, ... ]
// }
//   Deletes existing source='haha' rows for that machine within [start, end], then
//   inserts the fresh ones — mirrors how /api/data/sales handles its daily sync.
//
// This table only tracks HAHA-sourced sales (hour-level detail isn't collected for
// manually logged entries) — it feeds the Sales by Hour / Sales by Day pattern chart,
// it is not part of the Gross/Net Sales KPI math on the Overview tab.
//
// Requires a D1 database bound as "DB". Sits behind Cloudflare Access.

function genId() {
  return crypto.randomUUID();
}

// If migration 002 hasn't been run yet, sale_hours won't exist. Degrade to an
// empty result instead of 500'ing — see the matching comment in data/health.js.
function isMissingTableError(err) {
  return /no such table/i.test(String(err && err.message || err));
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const start = url.searchParams.get('start');
  const end = url.searchParams.get('end');
  const machineId = url.searchParams.get('machineId');

  try {
    let query = 'SELECT id, machine_id as machineId, date, hour, gross, source FROM sale_hours WHERE 1=1';
    const binds = [];
    if (start) { binds.push(start); query += ` AND date >= ?${binds.length}`; }
    if (end) { binds.push(end); query += ` AND date <= ?${binds.length}`; }
    if (machineId) { binds.push(machineId); query += ` AND machine_id = ?${binds.length}`; }
    query += ' ORDER BY date ASC, hour ASC';

    const { results } = await env.DB.prepare(query).bind(...binds).all();
    return Response.json({ hours: results });
  } catch (err) {
    if (isMissingTableError(err)) {
      return Response.json({ hours: [], _migrationNeeded: 'migrations/002_add_health_and_sale_hours.sql' });
    }
    return Response.json({ error: String(err.message || err) }, { status: 500 });
  }
}

export async function onRequestPost({ request, env }) {
  const body = await request.json();
  const { machineId, start, end, entries = [] } = body;
  if (!machineId || !start || !end) {
    return Response.json({ error: 'machineId, start, and end are required' }, { status: 400 });
  }

  try {
    await env.DB.prepare(
      `DELETE FROM sale_hours WHERE machine_id = ?1 AND source = 'haha' AND date >= ?2 AND date <= ?3`
    ).bind(machineId, start, end).run();

    const stmts = entries.map((e) =>
      env.DB.prepare(
        `INSERT INTO sale_hours (id, machine_id, date, hour, gross, source) VALUES (?1, ?2, ?3, ?4, ?5, 'haha')`
      ).bind(genId(), machineId, e.date, e.hour, e.gross || 0)
    );
    if (stmts.length) await env.DB.batch(stmts);

    return Response.json({ ok: true, inserted: stmts.length });
  } catch (err) {
    if (isMissingTableError(err)) {
      return Response.json({
        ok: false,
        error: 'The sale_hours table doesn\'t exist yet — run migrations/002_add_health_and_sale_hours.sql against the D1 database, then try again.',
      });
    }
    return Response.json({ ok: false, error: String(err.message || err) }, { status: 500 });
  }
}
