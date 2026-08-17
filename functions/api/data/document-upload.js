// /api/data/document-upload
// Generic document storage, reusing the existing RECEIPTS R2 bucket under
// a folder prefix (contracts/, demo-resources/) rather than requiring a
// second R2 bucket to be created and bound before v1.10.2 §11/§13 can
// work — same bucket, just organized by prefix, so no new deploy-time
// setup step beyond what already exists (DEPLOY_RECEIPTS_R2.md).
//
// POST -> multipart/form-data, fields "file" and "folder" ('contracts' |
//   'demo-resources') -> { key, name }
// GET  ?key=... -> streams the file back
// DELETE ?key=... -> removes the object
//
// Requires an R2 bucket bound as "RECEIPTS". Sits behind Cloudflare Access.

const MAX_BYTES = 25 * 1024 * 1024; // a bit more generous than receipts — contracts/brochures can be multi-page PDFs
const ALLOWED_FOLDERS = new Set(['contracts', 'demo-resources']);
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/heic', 'image/webp', 'application/pdf']);

function genKey(folder, filename) {
  const safe = (filename || 'document').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100);
  return `${folder}/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}-${safe}`;
}

export async function onRequestPost({ request, env }) {
  if (!env.RECEIPTS) {
    return Response.json({ error: 'Document storage is not configured yet — see DEPLOY_RECEIPTS_R2.md to create and bind the R2 bucket.' }, { status: 500 });
  }
  let form;
  try {
    form = await request.formData();
  } catch (err) {
    return Response.json({ error: 'Expected multipart/form-data with "file" and "folder" fields.' }, { status: 400 });
  }
  const file = form.get('file');
  const folder = form.get('folder');
  if (!ALLOWED_FOLDERS.has(folder)) return Response.json({ error: 'folder must be "contracts" or "demo-resources"' }, { status: 400 });
  if (!file || typeof file.arrayBuffer !== 'function') {
    return Response.json({ error: 'No file provided.' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ error: `File is too large (max ${MAX_BYTES / 1024 / 1024}MB).` }, { status: 400 });
  }
  if (file.type && !ALLOWED_TYPES.has(file.type)) {
    return Response.json({ error: `Unsupported file type "${file.type}" — use a photo (JPG/PNG/HEIC/WebP) or PDF.` }, { status: 400 });
  }

  const key = genKey(folder, file.name);
  await env.RECEIPTS.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type || 'application/octet-stream' },
  });
  return Response.json({ key, name: file.name || 'document' });
}

export async function onRequestGet({ request, env }) {
  if (!env.RECEIPTS) return Response.json({ error: 'Document storage is not configured yet.' }, { status: 500 });
  const url = new URL(request.url);
  const key = url.searchParams.get('key');
  if (!key) return Response.json({ error: 'key query param required' }, { status: 400 });

  const obj = await env.RECEIPTS.get(key);
  if (!obj) return Response.json({ error: 'Document not found.' }, { status: 404 });

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('etag', obj.httpEtag);
  headers.set('Cache-Control', 'private, max-age=3600');
  return new Response(obj.body, { headers });
}

export async function onRequestDelete({ request, env }) {
  if (!env.RECEIPTS) return Response.json({ error: 'Document storage is not configured yet.' }, { status: 500 });
  const url = new URL(request.url);
  const key = url.searchParams.get('key');
  if (!key) return Response.json({ error: 'key query param required' }, { status: 400 });
  await env.RECEIPTS.delete(key);
  return Response.json({ ok: true });
}
