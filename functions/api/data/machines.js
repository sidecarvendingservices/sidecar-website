// /api/data/machines
// GET    -> { machines: [...] }  (includes propertyId/status once migration 005 has run)
// POST   -> body: { id?, name, host, address, plan, install, hahaId, contactName, contactPhone,
//                    contactEmail, propertyId?, status?, retiredAt?, retiredReason? }
//           creates a new machine if id is omitted, otherwise updates that id.
// DELETE ?id=... -> removes a machine (its sales/expenses history is left in place)
//           Prefer POST with status: 'retired' instead — see promoteMachineStatus below.
//           Historical sales/orders keep showing the real machine name either way.
//
// Requires a D1 database bound to this Pages project as "DB"
// (Settings -> Functions -> D1 database bindings -> variable name: DB).
// This route should sit behind Cloudflare Access — see setup notes.
//
// contact_name / contact_phone / contact_email were added via
// migrations/001_add_contact_fields.sql.
// property_id / status / retired_at / retired_reason were added via
// migrations/005_properties_contacts_activity_tasks.sql — this file works
// before or after that migration has been run (falls back to the narrower
// column set if the new columns don't exist yet).

import { logAudit } from '../../_lib/audit.js';

function genId() {
  return crypto.randomUUID();
}
function isMissingColumnOrTable(err) {
  return /no such (table|column)/i.test(String(err && err.message || err));
}

const WIDE_SELECT = `SELECT id, name, host, address, plan, install, haha_id as hahaId,
         contact_name as contactName, contact_phone as contactPhone, contact_email as contactEmail,
         property_id as propertyId, status, retired_at as retiredAt, retired_reason as retiredReason
       FROM machines ORDER BY created_at ASC`;
const NARROW_SELECT = `SELECT id, name, host, address, plan, install, haha_id as hahaId,
         contact_name as contactName, contact_phone as contactPhone, contact_email as contactEmail
       FROM machines ORDER BY created_at ASC`;

export async function onRequestGet({ env }) {
  try {
    const { results } = await env.DB.prepare(WIDE_SELECT).all();
    return Response.json({ machines: results });
  } catch (err) {
    if (!isMissingColumnOrTable(err)) return Response.json({ error: String(err.message || err) }, { status: 500 });
    const { results } = await env.DB.prepare(NARROW_SELECT).all();
    return Response.json({
      machines: results.map((m) => ({ ...m, propertyId: null, status: 'active', retiredAt: null, retiredReason: null })),
      _migrationNeeded: 'migrations/005_properties_contacts_activity_tasks.sql',
    });
  }
}

export async function onRequestPost({ request, env }) {
  const body = await request.json();
  const {
    name, host = '', address = '', plan = 'none', install = '', hahaId = '',
    contactName = '', contactPhone = '', contactEmail = '',
    propertyId = null, status = 'active', retiredAt = null, retiredReason = null,
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

  const responseBody = { name, host, address, plan, install, hahaId, contactName, contactPhone, contactEmail, propertyId, status, retiredAt, retiredReason };

  // Explicit update-vs-insert (rather than INSERT ... ON CONFLICT) so this
  // never silently inserts a second row for an id that should have been
  // updated, regardless of how the id column's constraints are defined.
  if (body.id) {
    const existing = await env.DB.prepare('SELECT id, property_id as propertyId FROM machines WHERE id = ?1').bind(body.id).first();
    if (existing) {
      try {
        await env.DB.prepare(
          `UPDATE machines SET
             name=?2, host=?3, address=?4, plan=?5, install=?6, haha_id=?7,
             contact_name=?8, contact_phone=?9, contact_email=?10,
             property_id=?11, status=?12, retired_at=?13, retired_reason=?14
           WHERE id=?1`
        ).bind(body.id, name, host, address, plan, install, hahaId, contactName, contactPhone, contactEmail, propertyId, status, retiredAt, retiredReason).run();
        // v1.10.1 F17 — which property a machine belongs to drives who's
        // responsible for it (inherited Account Manager/Stocker, F14), so
        // it's worth its own audit action distinct from routine field edits.
        if ((existing.propertyId || null) !== (propertyId || null)) {
          await logAudit(env, request, {
            action: 'machine_reassign', entityType: 'machine', entityId: body.id, entityLabel: name,
            before: { propertyId: existing.propertyId || null }, after: { propertyId: propertyId || null },
          });
        }
      } catch (err) {
        if (!isMissingColumnOrTable(err)) return Response.json({ error: String(err.message || err) }, { status: 500 });
        await env.DB.prepare(
          `UPDATE machines SET name=?2, host=?3, address=?4, plan=?5, install=?6, haha_id=?7,
             contact_name=?8, contact_phone=?9, contact_email=?10 WHERE id=?1`
        ).bind(body.id, name, host, address, plan, install, hahaId, contactName, contactPhone, contactEmail).run();
      }
      return Response.json({ id: body.id, ...responseBody });
    }
  }

  const id = body.id || genId();
  try {
    await env.DB.prepare(
      `INSERT INTO machines (id, name, host, address, plan, install, haha_id, contact_name, contact_phone, contact_email, property_id, status, retired_at, retired_reason)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`
    ).bind(id, name, host, address, plan, install, hahaId, contactName, contactPhone, contactEmail, propertyId, status, retiredAt, retiredReason).run();
  } catch (err) {
    if (!isMissingColumnOrTable(err)) return Response.json({ error: String(err.message || err) }, { status: 500 });
    await env.DB.prepare(
      `INSERT INTO machines (id, name, host, address, plan, install, haha_id, contact_name, contact_phone, contact_email)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`
    ).bind(id, name, host, address, plan, install, hahaId, contactName, contactPhone, contactEmail).run();
  }

  return Response.json({ id, ...responseBody });
}

export async function onRequestDelete({ request, env }) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return Response.json({ error: 'id query param required' }, { status: 400 });
  await env.DB.prepare('DELETE FROM machines WHERE id = ?1').bind(id).run();
  return Response.json({ ok: true });
}
