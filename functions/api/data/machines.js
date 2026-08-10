// /api/data/machines
// GET    -> { machines: [...] }
// POST   -> body: { id?, name, host, address, plan, install, hahaId, contactName, contactPhone, contactEmail }
//           creates a new machine if id is omitted, otherwise updates that id.
// DELETE ?id=... -> removes a machine (its sales/expenses history is left in place)
//
// Requires a D1 database bound to this Pages project as "DB"
// (Settings -> Functions -> D1 database bindings -> variable name: DB).
// This route should sit behind Cloudflare Access — see setup notes.
//
// contact_name / contact_phone / contact_email were added via
// migrations/001_add_contact_fields.sql — run that once if you set this
// database up before that migration existed.

function genId() {
  return crypto.randomUUID();
}

export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare(
    `SELECT id, name, host, address, plan, install, haha_id as hahaId,
            contact_name as contactName, contact_phone as contactPhone, contact_email as contactEmail
     FROM machines ORDER BY created_at ASC`
  ).all();
  return Response.json({ machines: results });
}

export async function onRequestPost({ request, env }) {
  const body = await request.json();
  const {
    name, host = '', address = '', plan = 'none', install = '', hahaId = '',
    contactName = '', contactPhone = '', contactEmail = '',
  } = body;
  if (!name) return Response.json({ error: 'name is required' }, { status: 400 });

  // A second machine with the same non-blank HAHA Market ID is almost always
  // a duplicate (re-import, double-click, etc.) rather than a real second
  // device — block it here with a clear message instead of silently creating
  // a duplicate row that only shows up later on the Machines tab.
  if (hahaId) {
    const dupeQuery = body.id
      ? env.DB.prepare('SELECT id, name FROM machines WHERE haha_id = ?1 AND id != ?2').bind(hahaId, body.id)
      : env.DB.prepare('SELECT id, name FROM machines WHERE haha_id = ?1').bind(hahaId);
    const dupe = await dupeQuery.first();
    if (dupe) {
      return Response.json({
        error: `HAHA Market ID "${hahaId}" is already used by "${dupe.name}". Edit that machine instead of adding a new one, or clear this field.`,
      }, { status: 409 });
    }
  }

  // Explicit update-vs-insert (rather than INSERT ... ON CONFLICT) so this
  // never silently inserts a second row for an id that should have been
  // updated, regardless of how the id column's constraints are defined.
  if (body.id) {
    const existing = await env.DB.prepare('SELECT id FROM machines WHERE id = ?1').bind(body.id).first();
    if (existing) {
      await env.DB.prepare(
        `UPDATE machines SET
           name=?2, host=?3, address=?4, plan=?5, install=?6, haha_id=?7,
           contact_name=?8, contact_phone=?9, contact_email=?10
         WHERE id=?1`
      ).bind(body.id, name, host, address, plan, install, hahaId, contactName, contactPhone, contactEmail).run();
      return Response.json({ id: body.id, name, host, address, plan, install, hahaId, contactName, contactPhone, contactEmail });
    }
  }

  const id = body.id || genId();
  await env.DB.prepare(
    `INSERT INTO machines (id, name, host, address, plan, install, haha_id, contact_name, contact_phone, contact_email)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`
  ).bind(id, name, host, address, plan, install, hahaId, contactName, contactPhone, contactEmail).run();

  return Response.json({ id, name, host, address, plan, install, hahaId, contactName, contactPhone, contactEmail });
}

export async function onRequestDelete({ request, env }) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return Response.json({ error: 'id query param required' }, { status: 400 });
  await env.DB.prepare('DELETE FROM machines WHERE id = ?1').bind(id).run();
  return Response.json({ ok: true });
}
