// /api/whoami
// GET -> { email, member } — reads Cloudflare Access's identity header
// (Cf-Access-Authenticated-User-Email, set automatically by Access on every
// request once it's turned on for this domain) and matches it against the
// team_members table, so the dashboard can show who's logged in and drive
// "My Tasks" filtering without any custom auth of its own.
//
// If Access isn't enabled yet (e.g. testing locally) the header is simply
// absent — this degrades to { email: null, member: null } rather than
// erroring, since Access is a deploy-time setting, not something this code
// controls.
//
// Requires a D1 database bound as "DB".

function isMissingTableError(err) {
  return /no such (table|column)/i.test(String(err && err.message || err));
}

export async function onRequestGet({ request, env }) {
  const email = (request.headers.get('Cf-Access-Authenticated-User-Email') || '').trim().toLowerCase();
  if (!email) return Response.json({ email: null, member: null });

  try {
    const member = await env.DB.prepare(
      `SELECT id, name, email, role, phone, status, notes FROM team_members WHERE email = ?1`
    ).bind(email).first();
    return Response.json({ email, member: member || null });
  } catch (err) {
    if (isMissingTableError(err)) return Response.json({ email, member: null, _migrationNeeded: 'migrations/009_team.sql' });
    return Response.json({ error: String(err.message || err) }, { status: 500 });
  }
}
