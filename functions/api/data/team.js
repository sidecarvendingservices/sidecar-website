// /api/data/team
// GET                -> { members: [...] }
// GET ?id=...         -> { member: {...}, properties: [{id, name, as}] }  (detail — "as" is
//                         'accountManager' or 'stocker', a member can show up as both)
// POST { id?, name, email, role, phone, status, notes }
// DELETE ?id=...      -> only allowed if not assigned as Account Manager or Stocker on any
//                         property (returns 409 with the property names otherwise)
//
// Requires a D1 database bound as "DB". Sits behind Cloudflare Access.
// Added via migrations/009_team.sql.

function genId(prefix) {
  return prefix + '_' + crypto.randomUUID();
}
function isMissingTableError(err) {
  return /no such (table|column)/i.test(String(err && err.message || err));
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  try {
    if (id) {
      const member = await env.DB.prepare(
        `SELECT id, name, email, role, phone, status, notes, created_at as createdAt FROM team_members WHERE id = ?1`
      ).bind(id).first();
      if (!member) return Response.json({ error: 'Team member not found' }, { status: 404 });

      const { results: asManager } = await env.DB.prepare(
        `SELECT id, name FROM properties WHERE account_manager_id = ?1`
      ).bind(id).all();
      const { results: asStocker } = await env.DB.prepare(
        `SELECT id, name FROM properties WHERE stocker_id = ?1`
      ).bind(id).all();

      return Response.json({
        member,
        properties: [
          ...asManager.map(p => ({ ...p, as: 'accountManager' })),
          ...asStocker.map(p => ({ ...p, as: 'stocker' })),
        ],
      });
    }

    const { results } = await env.DB.prepare(
      `SELECT id, name, email, role, phone, status, notes, created_at as createdAt FROM team_members ORDER BY name ASC`
    ).all();
    return Response.json({ members: results });
  } catch (err) {
    if (isMissingTableError(err)) return Response.json({ members: [], _migrationNeeded: 'migrations/009_team.sql' });
    return Response.json({ error: String(err.message || err) }, { status: 500 });
  }
}

export async function onRequestPost({ request, env }) {
  const body = await request.json();
  const { name, email, role = 'Stocker', phone = '', status = 'active', notes = '' } = body;
  if (!name) return Response.json({ error: 'name is required' }, { status: 400 });
  if (!email) return Response.json({ error: 'email is required — this is what ties them to a dashboard login' }, { status: 400 });
  const normalizedEmail = String(email).trim().toLowerCase();

  try {
    const dupe = await env.DB.prepare('SELECT id FROM team_members WHERE email = ?1 AND id != ?2')
      .bind(normalizedEmail, body.id || '').first();
    if (dupe) return Response.json({ error: 'Another team member already uses that email.' }, { status: 409 });

    if (body.id) {
      const existing = await env.DB.prepare('SELECT id FROM team_members WHERE id = ?1').bind(body.id).first();
      if (existing) {
        await env.DB.prepare(
          `UPDATE team_members SET name=?2, email=?3, role=?4, phone=?5, status=?6, notes=?7 WHERE id=?1`
        ).bind(body.id, name, normalizedEmail, role, phone, status, notes).run();
        return Response.json({ id: body.id, name, email: normalizedEmail, role, phone, status, notes });
      }
    }
    const id = body.id || genId('team');
    const createdAt = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO team_members (id, name, email, role, phone, status, notes, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`
    ).bind(id, name, normalizedEmail, role, phone, status, notes, createdAt).run();
    return Response.json({ id, name, email: normalizedEmail, role, phone, status, notes, createdAt });
  } catch (err) {
    if (isMissingTableError(err)) {
      return Response.json({ error: 'Run migrations/009_team.sql against the D1 database, then try again.' }, { status: 500 });
    }
    return Response.json({ error: String(err.message || err) }, { status: 500 });
  }
}

export async function onRequestDelete({ request, env }) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return Response.json({ error: 'id query param required' }, { status: 400 });

  const { results: linked } = await env.DB.prepare(
    `SELECT name FROM properties WHERE account_manager_id = ?1 OR stocker_id = ?1`
  ).bind(id).all();
  if (linked.length) {
    return Response.json({ error: `Still assigned on ${linked.length} propert${linked.length === 1 ? 'y' : 'ies'} (${linked.map(p => p.name).join(', ')}) — reassign those first.` }, { status: 409 });
  }
  await env.DB.prepare('DELETE FROM team_members WHERE id = ?1').bind(id).run();
  return Response.json({ ok: true });
}
