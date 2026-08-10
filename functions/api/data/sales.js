// /api/data/sales
// GET  ?start=&end=&machineId=   -> { sales: [...] }  (all filters optional)
// POST  two modes:
//   1) Manual single entry: { machineId, date, gross, cogs, fees }
//   2) HAHA sync (bulk, idempotent replace): {
//        sync: true, machineId, start, end,
//        entries: [ { date, gross }, ... ]   // one row per day, source becomes 'haha'
//      }
//      Deletes existing source='haha' rows for that machine within [start, end],
//      then inserts the fresh ones. Manual entries are never touched by a sync.
// DELETE ?id=...
//
// Requires a D1 database bound as "DB". Sits behind Cloudflare Access.

function genId() {
  return crypto.randomUUID();
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const start = url.searchParams.get('start');
  const end = url.searchParams.get('end');
  const machineId = url.searchParams.get('machineId');

  let query = 'SELECT id, machine_id as machineId, date, gross, cogs, fees, source FROM sales WHERE 1=1';
  const binds = [];
  if (start) { binds.push(start); query += ` AND date >= ?${binds.length}`; }
  if (end) { binds.push(end); query += ` AND date <= ?${binds.length}`; }
  if (machineId) { binds.push(machineId); query += ` AND machine_id = ?${binds.length}`; }
  query += ' ORDER BY date DESC';

  const { results } = await env.DB.prepare(query).bind(...binds).all();
  return Response.json({ sales: results });
}

export async function onRequestPost({ request, env }) {
  const body = await request.json();

  if (body.sync) {
    const { machineId, start, end, entries = [] } = body;
    if (!machineId || !start || !end) {
      return Response.json({ error: 'machineId, start, and end are required for sync' }, { status: 400 });
    }
    await env.DB.prepare(
      `DELETE FROM sales WHERE machine_id = ?1 AND source = 'haha' AND date >= ?2 AND date <= ?3`
    ).bind(machineId, start, end).run();

    const stmts = entries.map((e) =>
      env.DB.prepare(
        `INSERT INTO sales (id, machine_id, date, gross, cogs, fees, source) VALUES (?1, ?2, ?3, ?4, 0, 0, 'haha')`
      ).bind(genId(), machineId, e.date, e.gross)
    );
    if (stmts.length) await env.DB.batch(stmts);

    return Response.json({ ok: true, inserted: entries.length });
  }

  const { machineId, date, gross, cogs = 0, fees = 0 } = body;
  if (!machineId || !date || gross === undefined) {
    return Response.json({ error: 'machineId, date, and gross are required' }, { status: 400 });
  }
  const id = genId();
  await env.DB.prepare(
    `INSERT INTO sales (id, machine_id, date, gross, cogs, fees, source) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'manual')`
  ).bind(id, machineId, date, gross, cogs, fees).run();

  return Response.json({ id, machineId, date, gross, cogs, fees, source: 'manual' });
}

export async function onRequestDelete({ request, env }) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return Response.json({ error: 'id query param required' }, { status: 400 });
  await env.DB.prepare('DELETE FROM sales WHERE id = ?1').bind(id).run();
  return Response.json({ ok: true });
}
