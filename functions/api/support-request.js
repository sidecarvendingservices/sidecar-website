// Cloudflare Pages Function — handles the native support form on /support.
//
// Route: this file lives at functions/api/support-request.js, which Cloudflare
// Pages automatically maps to POST /api/support-request. No build step or
// wrangler.toml route config is needed — Pages Functions "just work" as long
// as this file is deployed alongside the rest of the site.
//
// What it does: validates the submitted fields, then calls the OpenPhone
// (now branded "Quo") REST API to send a text message to the Sidecar team's
// phone(s) with the details of the request. On success it redirects the
// browser to /support-thank-you.html; on failure it redirects back to
// /support with an ?error= code so the page can show a message.
//
// ── ONE-TIME SETUP (Brian) ──────────────────────────────────────────────
// This function reads three values from environment variables / secrets.
// Set them in the Cloudflare dashboard: Workers & Pages → sidecar-website →
// Settings → Environment variables (do this for both "Production" and
// "Preview" environments, or requests from preview deploys will fail).
//
//   QUO_API_KEY      Your OpenPhone/Quo API key. Generate one at
//                     Quo/OpenPhone app → Settings → API. Mark this one as
//                     "Secret" (encrypted) in the Cloudflare dashboard, not
//                     a plain-text variable.
//   QUO_FROM_NUMBER   The OpenPhone number to send FROM, in E.164 format,
//                     e.g. +14708393656. Must be a number on your OpenPhone
//                     account.
//   SUPPORT_ALERT_TO  The phone number(s) that should receive the text when
//                     someone submits the form, in E.164 format. Comma-
//                     separate multiple numbers, e.g. +14045551234,+14045555678
//
// For local testing with `wrangler pages dev`, copy .dev.vars.example to
// .dev.vars and fill in real values there instead (that file is gitignored).
// ──────────────────────────────────────────────────────────────────────────

const QUO_API_URL = 'https://api.quo.com/v1/messages';
const SMS_CHAR_LIMIT = 1200; // stay comfortably under typical multi-segment limits

export async function onRequestPost(context) {
  const { request, env } = context;

  let formData;
  try {
    formData = await request.formData();
  } catch (err) {
    return redirectTo(request, '/support?error=invalid#support-form');
  }

  // Honeypot: a real visitor never sees or fills this field (see support.html).
  // If it's filled, silently pretend success so bots don't learn anything.
  const honeypot = (formData.get('company') || '').toString().trim();
  if (honeypot !== '') {
    return redirectTo(request, '/support-thank-you.html');
  }

  const name = (formData.get('name') || '').toString().trim();
  const phoneRaw = (formData.get('phone') || '').toString().trim();
  const location = (formData.get('location') || '').toString().trim();
  const machineId = (formData.get('machineId') || '').toString().trim();
  const reason = (formData.get('reason') || '').toString().trim();
  const details = (formData.get('details') || '').toString().trim();

  if (!name || !phoneRaw || !location || !reason || !details) {
    return redirectTo(request, '/support?error=missing#support-form');
  }

  const phoneE164 = toE164(phoneRaw);
  if (!phoneE164) {
    return redirectTo(request, '/support?error=phone#support-form');
  }

  const alertRecipients = (env.SUPPORT_ALERT_TO || '')
    .split(',')
    .map((n) => n.trim())
    .filter(Boolean);

  if (!env.QUO_API_KEY || !env.QUO_FROM_NUMBER || alertRecipients.length === 0) {
    console.error(
      'Support form is not fully configured — missing QUO_API_KEY, QUO_FROM_NUMBER, or SUPPORT_ALERT_TO. ' +
        'Set these in Cloudflare Pages → Settings → Environment variables.'
    );
    return redirectTo(request, '/support?error=config#support-form');
  }

  const content = [
    'Sidecar Support Request',
    `Reason: ${reason}`,
    `From: ${name} (${phoneE164})`,
    `Location: ${location}${machineId ? ` / Machine ${machineId}` : ''}`,
    `Details: ${details}`,
  ]
    .join('\n')
    .slice(0, SMS_CHAR_LIMIT);

  try {
    const quoResponse = await fetch(QUO_API_URL, {
      method: 'POST',
      headers: {
        Authorization: env.QUO_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        content,
        from: env.QUO_FROM_NUMBER,
        to: alertRecipients,
      }),
    });

    if (!quoResponse.ok) {
      const errBody = await quoResponse.text().catch(() => '');
      console.error(`Quo/OpenPhone API returned ${quoResponse.status}: ${errBody}`);
      // TEMP DIAGNOSTIC (Brian, 2026-07-26): surfacing the status code and a
      // short slice of the response body in the redirect so we can see why
      // the send failed without needing to dig through Cloudflare's log
      // viewer. Safe to remove once the SMS path is confirmed working —
      // nothing sensitive (no API key, no phone numbers) is included.
      const debugDetail = encodeURIComponent(`${quoResponse.status}:${errBody.slice(0, 150)}`);
      return redirectTo(request, `/support?error=send&detail=${debugDetail}#support-form`);
    }
  } catch (err) {
    console.error('Quo/OpenPhone API request failed:', err);
    const debugDetail = encodeURIComponent(String(err && err.message ? err.message : err).slice(0, 150));
    return redirectTo(request, `/support?error=send&detail=${debugDetail}#support-form`);
  }

  return redirectTo(request, '/support-thank-you.html');
}

// Any non-POST method (GET, etc.) hitting this route gets a plain 405 —
// there's nothing to render at this URL, it's an endpoint, not a page.
export async function onRequestGet() {
  return new Response('Method Not Allowed', { status: 405 });
}

function redirectTo(request, path) {
  return Response.redirect(new URL(path, request.url), 303);
}

// Normalizes a user-typed US/Canada phone number to E.164 (+1XXXXXXXXXX).
// Returns null if it doesn't look like a valid 10 or 11 digit NANP number.
// (Sidecar's service area is metro Atlanta, so NANP-only is a safe default —
// widen this if the support line ever needs to take international numbers.)
function toE164(raw) {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}
