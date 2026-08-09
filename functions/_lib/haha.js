// Shared helper for talking to the HAHA Open Platform API.
// Not routed directly (lives under functions/_lib/), imported by functions/api/haha-*.js.
//
// Required Cloudflare Pages environment variables (set as Secrets, Production + Preview):
//   HAHA_APP_KEY     - the appkey HAHA issued
//   HAHA_APP_SECRET  - the appsecret HAHA issued (never expose this to the browser)
// Optional:
//   HAHA_API_BASE    - defaults to the production HAHA domain below

const DEFAULT_BASE = 'https://thor-openapi.hahavending.com';

/**
 * Obtains a fresh Bearer token from HAHA.
 * HAHA tokens are valid 15 days, but we simply fetch a new one per request for now —
 * simplest to reason about at this traffic level. If this dashboard is checked very
 * frequently, revisit with a Cloudflare KV cache keyed on expiry.
 */
export async function getHahaToken(env) {
  const base = env.HAHA_API_BASE || DEFAULT_BASE;
  const res = await fetch(`${base}/open/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      appkey: env.HAHA_APP_KEY,
      appsecret: env.HAHA_APP_SECRET,
    }),
  });
  const data = await res.json();
  if (!res.ok || data.code !== 0 || !data.data || !data.data.token) {
    throw new Error('HAHA auth failed: ' + JSON.stringify(data));
  }
  return data.data.token;
}

/**
 * Calls a HAHA Open Platform GET endpoint with the given query params, handling auth.
 * path should start with /open/api/v1/...
 */
export async function hahaGet(env, path, params = {}) {
  const base = env.HAHA_API_BASE || DEFAULT_BASE;
  const token = await getHahaToken(env);
  const url = new URL(base + path);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  });
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  if (!res.ok || data.code !== 0) {
    throw new Error('HAHA API error: ' + JSON.stringify(data));
  }
  return data.data;
}

// Permissive CORS so the dashboard (which may be opened from a different origin,
// e.g. a Claude artifact) can call this proxy directly. Tighten to a specific
// origin later if you want this locked down further.
export function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}
