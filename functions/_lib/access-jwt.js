// Verifies the Cf-Access-Jwt-Assertion header Cloudflare Access attaches to
// requests that reach Pages Functions/Workers. Unlike traditional reverse-
// proxied origins, Access does NOT add a plain Cf-Access-Authenticated-User-Email
// header for apps hosted on Pages/Workers — it hands the origin a signed JWT
// instead and expects the origin to verify it. (Confirmed via a debug dump on
// 2026-08-16: the header simply isn't present, but a valid, correctly-signed
// cf-access-jwt-assertion is.) This is Cloudflare's documented pattern:
// https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/
//
// Requires two Cloudflare Pages environment variables/secrets, set once:
//   CF_ACCESS_TEAM_DOMAIN  e.g. "quiet-king-dff0.cloudflareaccess.com"
//   CF_ACCESS_AUD          the Access application's Audience (AUD) tag
// If either is missing, verification is skipped and this returns null —
// degrades to "not logged in" rather than trusting an unverified claim.

let cachedCerts = null;
let cachedCertsAt = 0;
const CERTS_TTL_MS = 60 * 60 * 1000; // re-fetch at most once an hour

function base64UrlToBytes(b64url) {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(b64url.length / 4) * 4, '=');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function base64UrlDecodeJson(b64url) {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(b64url)));
}

async function getCerts(teamDomain) {
  const now = Date.now();
  if (cachedCerts && (now - cachedCertsAt) < CERTS_TTL_MS) return cachedCerts;
  const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error('Could not fetch Access certs (' + res.status + ')');
  const data = await res.json();
  cachedCerts = data.keys || data.public_certs || [];
  cachedCertsAt = now;
  return cachedCerts;
}

// Returns the verified, lowercased email string, or null if the header is
// missing, malformed, expired, wrong-audience, or fails signature
// verification. Callers should treat null exactly like "not logged in."
export async function verifyAccessEmail(request, env) {
  const teamDomain = env.CF_ACCESS_TEAM_DOMAIN;
  const aud = env.CF_ACCESS_AUD;
  if (!teamDomain || !aud) return null;

  const jwt = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!jwt) return null;

  const parts = jwt.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;

  let header, payload;
  try {
    header = base64UrlDecodeJson(headerB64);
    payload = base64UrlDecodeJson(payloadB64);
  } catch (e) {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === 'number' && now > payload.exp) return null;
  if (typeof payload.nbf === 'number' && now < payload.nbf) return null;
  if (!Array.isArray(payload.aud) || !payload.aud.includes(aud)) return null;

  let keys;
  try {
    keys = await getCerts(teamDomain);
  } catch (e) {
    return null;
  }
  const jwk = keys.find(k => k.kid === header.kid);
  if (!jwk) return null;

  let cryptoKey;
  try {
    cryptoKey = await crypto.subtle.importKey(
      'jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']
    );
  } catch (e) {
    return null;
  }

  const signedData = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signature = base64UrlToBytes(sigB64);

  let valid = false;
  try {
    valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, signature, signedData);
  } catch (e) {
    return null;
  }
  if (!valid) return null;

  return (payload.email || '').trim().toLowerCase() || null;
}
