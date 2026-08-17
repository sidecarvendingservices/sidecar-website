// /api/data/demo-resources
// GET  -> { resources: [...] }
// POST -> body: { title, fileKey, fileName, description? } — upload via
//   /api/data/document-upload first (folder=demo-resources), then record it here.
// DELETE ?id=...
//
// Requires a D1 database bound as "DB". Sits behind Cloudflare Access.
// Added via migrations/016_contracts_demo_resources.sql.
// v1.10.2 §13 — site-visit materials shelf; empty until Brian supplies
// content (virtual brochure, product guide examples, etc.).

import { verifyAccessEmail } from '../../_lib/access-jwt.js';

function genId() { return 'demo_' + crypto.randomUUID(); }
function isMissingTableOrColumn(err) {
  return /no such (table|column)/i.test(String(err && err.message || err));
}

export async function onRequestGet({ env }) {
  try {
    const { results } = await env.DB.prepare(
      `SELECT id, title, description, file_key as fileKey, file_name as fileName, uploaded_by as uploadedBy, uploaded_at as uploadedAt
       FROM demo_resources ORDER BY uploaded_at DESC`
    ).all();
    return Response.json({ resources: results });
  } catch (err) {
    if (isMissingTableOrColumn(err)) return Response.json({ resources: [], _migrationNeeded: 'migrations/016_contracts_demo_resources.sql' });
    return Response.json({ error: String(err.message || err) }, { status: 500 });
  }
}

export async function onRequestPost({ request, env }) {
  const body = await request.json();
  const { title, fileKey, fileName = '', description = '' } = body;
  if (!title || !fileKey) return Response.json({ error: 'title and fileKey are required' }, { status: 400 });
  const email = await verifyAccessEmail(request, env);
  const id = genId();
  const now = new Date().toISOString();
  try {
    await env.DB.prepare(
      `INSERT INTO demo_resources (id, title, description, file_key, file_name, uploaded_by, uploaded_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
    ).bind(id, title, description, fileKey, fileName, email || null, now).run();
  } catch (err) {
    if (isMissingTableOrColumn(err)) return Response.json({ error: 'Run migrations/016_contracts_demo_resources.sql against the D1 database, then try again.' }, { status: 500 });
    return Response.json({ error: String(err.message || err) }, { status: 500 });
  }
  return Response.json({ id, title, description, fileKey, fileName });
}

export async function onRequestDelete({ request, env }) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return Response.json({ error: 'id query param required' }, { status: 400 });
  await env.DB.prepare('DELETE FROM demo_resources WHERE id = ?1').bind(id).run();
  return Response.json({ ok: true });
}
