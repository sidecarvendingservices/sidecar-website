// v1.10.1 F17 — shared audit-logging helper.
//
// Call this from any Function that changes something worth a record of
// "who did this and what changed" (see migrations/015_audit_log.sql).
// Never throws into the caller's request — an audit-log write failing
// (e.g. migration not yet run) should never block the actual business
// action it's describing, so failures here are swallowed after a console
// warning rather than surfaced as a 500 to the user.
//
// Usage:
//   import { logAudit } from '../_lib/audit.js';
//   await logAudit(env, request, {
//     action: 'role_change', entityType: 'team_member', entityId: id,
//     entityLabel: name, before: { role: oldRole }, after: { role: newRole },
//   });

import { getCurrentMember } from './auth.js';

function genId() {
  return 'audit_' + crypto.randomUUID();
}

export async function logAudit(env, request, { action, entityType, entityId, entityLabel = null, before = null, after = null, outcome = 'success' }) {
  try {
    const { email, member } = await getCurrentMember(request, env);
    await env.DB.prepare(
      `INSERT INTO audit_log (id, actor_email, actor_name, action, entity_type, entity_id, entity_label, before_json, after_json, outcome, occurred_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`
    ).bind(
      genId(), email || null, member ? member.name : null, action, entityType, String(entityId), entityLabel,
      before !== null ? JSON.stringify(before) : null,
      after !== null ? JSON.stringify(after) : null,
      outcome, new Date().toISOString()
    ).run();
  } catch (err) {
    // Table probably doesn't exist yet (migration not run) or some other
    // non-critical issue — log and move on, never block the real action.
    console.warn('logAudit failed (non-blocking):', err && err.message || err);
  }
}
