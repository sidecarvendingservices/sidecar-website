// Server-side half of the permissions gate (v1.10.1 F5).
//
// The client-side half (hasRole/requireRole in ops-dashboard.html) hides
// or disables controls in the UI — but that's just a nicer experience,
// not real security, since anyone can call the API directly. This file
// is the half that actually can't be bypassed: any Function that guards
// a sensitive action (device commands, pricing edits, planogram edits,
// etc. — landing in v1.10.2) should call requireRole() before doing the
// work, and return its Response directly if it's non-null.
//
// Fixed role set (must match the Team tab's role <select> in
// ops-dashboard.html and migrations/014_role_formalize.sql):
//   Admin, Stocker, Receiver, Sales, Account Manager
// Only Admin is meaningfully enforced today — see V1.10.2_SPEC.md §15
// for defining the others once a real non-admin user needs access.
//
// Requires a D1 database bound as "DB". Identity comes from the same
// verified Access JWT whoami.js uses (see access-jwt.js) — this file
// doesn't do its own auth, it trusts Cloudflare Access the same way, and
// needs the same CF_ACCESS_TEAM_DOMAIN / CF_ACCESS_AUD env vars set.

import { verifyAccessEmail } from './access-jwt.js';

export async function getCurrentMember(request, env) {
  const email = await verifyAccessEmail(request, env);
  if (!email) return { email: null, member: null };
  try {
    const member = await env.DB.prepare(
      `SELECT id, name, email, role, status FROM team_members WHERE email = ?1`
    ).bind(email).first();
    return { email, member: member || null };
  } catch (err) {
    return { email, member: null };
  }
}

// Returns null if the request is allowed to proceed, or a Response (403)
// to return immediately if it isn't. Usage in a Function:
//
//   const denied = await requireRole(request, env, ['Admin']);
//   if (denied) return denied;
//
export async function requireRole(request, env, allowedRoles) {
  const { email, member } = await getCurrentMember(request, env);
  const role = member ? member.role : null;
  if (role && member.status === 'active' && allowedRoles.includes(role)) return null;

  return Response.json(
    {
      error: `Not permitted — requires role: ${allowedRoles.join(', ')}`,
      yourRole: role || null,
      email: email || null,
    },
    { status: 403 }
  );
}
