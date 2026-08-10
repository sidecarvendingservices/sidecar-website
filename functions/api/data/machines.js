// /api/data/machines
// GET    -> { machines: [...] }
// POST   -> body: { id?, name, host, address, plan, install, hahaId }
//           creates a new machine if id is omitted, otherwise updates that id.
// DELETE ?id=... -> removes a machine (its sales/expenses history is left in place)
//
// Requires a D1 database bound to this Pages project as "DB"
// (Settings -> Functions -> D1 database bindings -> variable name: DB).
// This route should sit behind Cloudflare Access — see setup notes.

function genId() {
  return crypto.randomUUID();
}

export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare(
    'SELECT id, name, host, address, plan, install, haha_id as hahaId FROM machines ORDER BY created_at ASC'
  ).all();
  return Response.json({ machines: results });
}

export async function onRequestPost({ request, env }) {
  const body = await request.json();
  const { name, host = '', address = '', plan = 'none', install = '', hahaId = '' } = body;
  if (!name) return Response.json({ error: 'name is required' }, { status: 400 });

  const id = body.id || genId();
  await env.DB.prepare(
    `INSERT INTO machines (id, name, host, address, plan, install, haha_id)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
     ON CONFLICT(id) DO UPDATE SET
       name=excluded.name, host=excluded.host, address=excluded.address,
       plan=excluded.plan, install=excluded.install, haha_id=excluded.haha_id`
  ).bind(id, name, host, address, plan, install, hahaId).run();

  return Response.json({ id, name, host, address, plan, install, hahaId });
}

export async function onRequestDelete({ request, env }) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return Response.json({ error: 'id query param required' }, { status: 400 });
  await env.DB.prepare('DELETE FROM machines WHERE id = ?1').bind(id).run();
  return Response.json({ ok: true });
}
