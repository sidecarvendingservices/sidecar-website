// Shared Google OAuth2 "refresh token -> access token" exchange, used by
// both the Google Ads and Google Analytics (GA4) marketing endpoints. Both
// integrations authenticate the same way — a one-time browser OAuth consent
// produces a refresh token, which is stored as a Cloudflare secret and
// exchanged for a short-lived access token on every request from here on.
// See DEPLOY_MARKETING.md for how to obtain each refresh token.

export async function getGoogleAccessToken({ clientId, clientSecret, refreshToken }) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error('Google OAuth token refresh failed: ' + JSON.stringify(data));
  }
  return data.access_token;
}

// Returns a list of which of the given env var names are missing/blank, so
// each endpoint can report a precise "connect this" state instead of a
// generic failure.
export function missingEnvVars(env, names) {
  return names.filter((n) => !env[n] || String(env[n]).trim() === '');
}
