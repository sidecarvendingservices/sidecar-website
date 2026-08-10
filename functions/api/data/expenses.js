// /api/data/expenses
// GET  ?start=&end=          -> { expenses: [...] }  (filters optional)
// POST -> body: { date, category, amount, machineId?, note? }
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

  let query = 'SELECT id, date, category, amount, machine_id as machineId, note FROM expenses WHERE 1=1';
  const binds = [];
  if (start) { binds.push(start); query += ` AND date >= ?${binds.length}`; }
  if (end) { binds.push(end); query += ` AND date <= ?${binds.length}`; }
  query += ' ORDER BY date DESC';

  const { results } = await env.DB.prepare(query).bind(...binds).all();
  return Response.json({ expenses: results });
}

export async function onRequestPost({ request, env }) {
  const body = await request.json();
  const { date, category, amount, machineId = null, note = '' } = body;
  if (!date || !category || amount === undefined) {
    return Response.json({ error: 'date, category, and amount are required' }, { status: 400 });
  }
  const id = genId();
  await env.DB.prepare(
    `INSERT INTO expenses (id, date, category, amount, machine_id, note) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
  ).bind(id, date, category, amount, machineId, note).run();

  return Response.json({ id, date, category, amount, machineId, note });
}

export async function onRequestDelete({ request, env }) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return Response.json({ error: 'id query param required' }, { status: 400 });
  await env.DB.prepare('DELETE FROM expenses WHERE id = ?1').bind(id).run();
  return Response.json({ ok: true });
}
