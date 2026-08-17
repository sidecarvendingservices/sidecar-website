// /api/data/audit-log
// GET -> { entries: [...] } — most recent 200 audit log entries, newest first.
// v1.10.1 F17. Requires migrations/015_audit_log.sql to have run; degrades
// to an empty list with a _migrationNeeded flag if it hasn't, same pattern
// as every other endpoint in this app.

function isMissingTableOrColumn(err) {
  return /no such (table|column)/i.test(String(err && err.message || err));
}

export async function onRequestGet({ env }) {
  try {
    const { results } = await env.DB.prepare(
      `SELECT id, actor_email as actorEmail, actor_name as actorName, action, entity_type as entityType,
              entity_id as entityId, entity_label as entityLabel, before_json as beforeJson, after_json as afterJson,
              outcome, occurred_at as occurredAt
       FROM audit_log ORDER BY occurred_at DESC LIMIT 200`
    ).all();
    return Response.json({
      entries: results.map(r => ({
        ...r,
        before: r.beforeJson ? JSON.parse(r.beforeJson) : null,
        after: r.afterJson ? JSON.parse(r.afterJson) : null,
      })),
    });
  } catch (err) {
    if (isMissingTableOrColumn(err)) {
      return Response.json({ entries: [], _migrationNeeded: 'migrations/015_audit_log.sql' });
    }
    return Response.json({ error: String(err.message || err) }, { status: 500 });
  }
}
