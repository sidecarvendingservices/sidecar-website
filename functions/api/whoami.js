// /api/whoami
// GET -> { email, member } — verifies Cloudflare Access's signed identity JWT
// (Cf-Access-Jwt-Assertion) and matches the email it contains against the
// team_members table, so the dashboard can show who's logged in and drive
// "My Tasks" filtering without any custom auth of its own.
//
// NOTE (found 2026-08-16): apps hosted on Cloudflare Pages/Workers do NOT get
// the simple Cf-Access-Authenticated-User-Email header some Access docs show —
// that's only added for traditional reverse-proxied origins. Pages/Workers get
// a signed JWT instead (Cf-Access-Jwt-Assertion) and are expected to verify it
// themselves — see functions/_lib/access-jwt.js for the verification and the
// two env vars (CF_ACCESS_TEAM_DOMAIN, CF_ACCESS_AUD) it needs set.
//
// If Access isn't enabled yet, or those env vars aren't set, this degrades to
// { email: null, member: null } rather than erroring — same as before.
//
// Requires a D1 database bound as "DB".

import { verifyAccessEmail } from '../_lib/access-jwt.js';

function isMissingTableError(err) {
  return /no such (table|column)/i.test(String(err && err.message || err));
}

export async function onRequestGet({ request, env }) {
  const email = await verifyAccessEmail(request, env);
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
