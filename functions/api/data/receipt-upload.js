// /api/data/receipt-upload
// POST -> multipart/form-data, field name "file" -> { key }
//   Uploads a receipt image/PDF to the "RECEIPTS" R2 bucket and returns the
//   object key to store on an expense's receipt_ref column.
// GET  ?key=... -> streams the file back (used by "View Receipt" links)
// DELETE ?key=... -> removes the object (used when a receipt is replaced or
//   an expense is deleted)
//
// Requires an R2 bucket bound as "RECEIPTS". Sits behind Cloudflare Access.
// See DEPLOY_RECEIPTS_R2.md for one-time setup — until that bucket exists,
// this endpoint returns a clear 500 instead of a cryptic binding error.

const MAX_BYTES = 15 * 1024 * 1024; // 15MB — generous for a phone photo/PDF, small enough to not abuse D1/R2 quotas
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/heic', 'image/webp', 'application/pdf']);

function genKey(filename) {
  const safe = (filename || 'receipt').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
  return `receipts/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}-${safe}`;
}

export async function onRequestPost({ request, env }) {
  if (!env.RECEIPTS) {
    return Response.json({ error: 'Receipt storage is not configured yet — see DEPLOY_RECEIPTS_R2.md to create and bind the R2 bucket.' }, { status: 500 });
  }
  let form;
  try {
    form = await request.formData();
  } catch (err) {
    return Response.json({ error: 'Expected multipart/form-data with a "file" field.' }, { status: 400 });
  }
  const file = form.get('file');
  if (!file || typeof file.arrayBuffer !== 'function') {
    return Response.json({ error: 'No file provided.' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ error: `File is too large (max ${MAX_BYTES / 1024 / 1024}MB).` }, { status: 400 });
  }
  if (file.type && !ALLOWED_TYPES.has(file.type)) {
    return Response.json({ error: `Unsupported file type "${file.type}" — use a photo (JPG/PNG/HEIC/WebP) or PDF.` }, { status: 400 });
  }

  const key = genKey(file.name);
  await env.RECEIPTS.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type || 'application/octet-stream' },
  });
  return Response.json({ key });
}

export async function onRequestGet({ request, env }) {
  if (!env.RECEIPTS) {
    return Response.json({ error: 'Receipt storage is not configured yet.' }, { status: 500 });
  }
  const url = new URL(request.url);
  const key = url.searchParams.get('key');
  if (!key) return Response.json({ error: 'key query param required' }, { status: 400 });

  const obj = await env.RECEIPTS.get(key);
  if (!obj) return Response.json({ error: 'Receipt not found.' }, { status: 404 });

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('etag', obj.httpEtag);
  headers.set('Cache-Control', 'private, max-age=3600');
  return new Response(obj.body, { headers });
}

export async function onRequestDelete({ request, env }) {
  if (!env.RECEIPTS) {
    return Response.json({ error: 'Receipt storage is not configured yet.' }, { status: 500 });
  }
  const url = new URL(request.url);
  const key = url.searchParams.get('key');
  if (!key) return Response.json({ error: 'key query param required' }, { status: 400 });
  await env.RECEIPTS.delete(key);
  return Response.json({ ok: true });
}
