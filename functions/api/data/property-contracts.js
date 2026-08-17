// /api/data/property-contracts
// GET ?propertyId=...   -> { contracts: [...], acknowledged: {...}|null }
//   contracts include machineIds: [...] (which machines this one covers).
// GET (no propertyId)   -> { contracts: [...] } every contract, for the
//   fleet-wide missing-contract flag computed client-side.
// POST -> body: { propertyId, fileKey, fileName, machineIds: [...], notes? }
//   Uploads happen via /api/data/document-upload first (folder=contracts);
//   this just records the resulting key. Uploading a real contract for a
//   property clears any "No Contract — Acknowledged" ack on file for it.
// POST { propertyId, acknowledge: true, notes? } -> records the
//   acknowledged-no-contract state instead of a real document.
// DELETE ?id=...        -> removes a contract record (and its coverage
//   rows) — does not delete the R2 object, so a removed-by-mistake record
//   could still be recovered from the file key if needed.
//
// Requires a D1 database bound as "DB". Sits behind Cloudflare Access.
// Added via migrations/016_contracts_demo_resources.sql.

import { verifyAccessEmail } from '../../_lib/access-jwt.js';
import { logAudit } from '../../_lib/audit.js';

function genId(prefix) { return prefix + '_' + crypto.randomUUID(); }
function isMissingTableOrColumn(err) {
  return /no such (table|column)/i.test(String(err && err.message || err));
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const propertyId = url.searchParams.get('propertyId');
  try {
    let query = `SELECT id, property_id as propertyId, file_key as fileKey, file_name as fileName,
                        notes, uploaded_by as uploadedBy, uploaded_at as uploadedAt
                 FROM property_contracts`;
    const binds = [];
    if (propertyId) { query += ' WHERE property_id = ?1'; binds.push(propertyId); }
    query += ' ORDER BY uploaded_at DESC';
    const { results: contracts } = await env.DB.prepare(query).bind(...binds).all();

    for (const c of contracts) {
      const { results: rows } = await env.DB.prepare('SELECT machine_id as machineId FROM contract_machines WHERE contract_id = ?1').bind(c.id).all();
      c.machineIds = rows.map(r => r.machineId);
    }

    let acknowledged = null;
    let acknowledgedPropertyIds = [];
    if (propertyId) {
      acknowledged = await env.DB.prepare(
        `SELECT property_id as propertyId, acknowledged_by as acknowledgedBy, acknowledged_at as acknowledgedAt, notes FROM property_contract_ack WHERE property_id = ?1`
      ).bind(propertyId).first();
    } else {
      // Fleet-wide fetch (no propertyId) — used by the Data Health/Action
      // Center missing-contract check, so it doesn't need one call per
      // property to know which ones are covered or acknowledged.
      const { results } = await env.DB.prepare('SELECT property_id as propertyId FROM property_contract_ack').all();
      acknowledgedPropertyIds = results.map(r => r.propertyId);
    }
    return Response.json({ contracts, acknowledged: acknowledged || null, acknowledgedPropertyIds });
  } catch (err) {
    if (isMissingTableOrColumn(err)) return Response.json({ contracts: [], acknowledged: null, _migrationNeeded: 'migrations/016_contracts_demo_resources.sql' });
    return Response.json({ error: String(err.message || err) }, { status: 500 });
  }
}

export async function onRequestPost({ request, env }) {
  const body = await request.json();
  const email = await verifyAccessEmail(request, env);
  const now = new Date().toISOString();

  if (body.acknowledge) {
    const { propertyId, notes = '' } = body;
    if (!propertyId) return Response.json({ error: 'propertyId is required' }, { status: 400 });
    try {
      await env.DB.prepare(
        `INSERT INTO property_contract_ack (property_id, acknowledged_by, acknowledged_at, notes) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(property_id) DO UPDATE SET acknowledged_by=?2, acknowledged_at=?3, notes=?4`
      ).bind(propertyId, email || null, now, notes).run();
      await logAudit(env, request, { action: 'contract_ack', entityType: 'property', entityId: propertyId, before: null, after: { acknowledged: true, notes } });
      return Response.json({ ok: true });
    } catch (err) {
      if (isMissingTableOrColumn(err)) return Response.json({ error: 'Run migrations/016_contracts_demo_resources.sql against the D1 database, then try again.' }, { status: 500 });
      return Response.json({ error: String(err.message || err) }, { status: 500 });
    }
  }

  const { propertyId, fileKey, fileName = '', machineIds = [], notes = '' } = body;
  if (!propertyId || !fileKey) return Response.json({ error: 'propertyId and fileKey are required' }, { status: 400 });

  const id = genId('contract');
  try {
    await env.DB.prepare(
      `INSERT INTO property_contracts (id, property_id, file_key, file_name, notes, uploaded_by, uploaded_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
    ).bind(id, propertyId, fileKey, fileName, notes, email || null, now).run();
    if (machineIds.length) {
      await env.DB.batch(machineIds.map(mid =>
        env.DB.prepare('INSERT INTO contract_machines (contract_id, machine_id) VALUES (?1, ?2)').bind(id, mid)
      ));
    }
    // A real contract now exists — clear any "acknowledged no contract" state for this property.
    await env.DB.prepare('DELETE FROM property_contract_ack WHERE property_id = ?1').bind(propertyId).run();
    await logAudit(env, request, { action: 'contract_upload', entityType: 'property', entityId: propertyId, entityLabel: fileName, before: null, after: { fileKey, fileName, machineIds } });
  } catch (err) {
    if (isMissingTableOrColumn(err)) return Response.json({ error: 'Run migrations/016_contracts_demo_resources.sql against the D1 database, then try again.' }, { status: 500 });
    return Response.json({ error: String(err.message || err) }, { status: 500 });
  }
  return Response.json({ id, propertyId, fileKey, fileName, machineIds, notes });
}

export async function onRequestDelete({ request, env }) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return Response.json({ error: 'id query param required' }, { status: 400 });
  await env.DB.prepare('DELETE FROM contract_machines WHERE contract_id = ?1').bind(id).run();
  await env.DB.prepare('DELETE FROM property_contracts WHERE id = ?1').bind(id).run();
  return Response.json({ ok: true });
}
