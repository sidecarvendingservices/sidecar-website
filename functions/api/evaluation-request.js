// Cloudflare Pages Function — handles the native "Free On-Site Evaluation"
// form (replaces the old HubSpot embed). Shared by every page that has a
// copy of the form — the homepage's #evaluation section, and per-industry
// pages like apartment-vending.html, each with their own #evaluation
// section further down the page.
//
// Route: this file lives at functions/api/evaluation-request.js, which
// Cloudflare Pages automatically maps to POST /api/evaluation-request. No
// build step or wrangler.toml route config is needed — Pages Functions
// "just work" as long as this file is deployed alongside the rest of the
// site (same pattern as functions/api/support-request.js).
//
// What it does: validates the submitted fields, then calls the Resend API
// to email the details to the Sidecar team. On success it redirects the
// browser to /thank-you.html; on failure it redirects back to whichever
// page the form was actually submitted from (using the Referer header),
// with an ?error= code so that page can show a message — this is what
// lets one function serve forms on multiple pages correctly.
//
// ── ONE-TIME SETUP (Brian) ──────────────────────────────────────────────
// This function reads two values from environment variables / secrets.
// Set them in the Cloudflare dashboard: Workers & Pages → sidecar-website →
// Settings → Environment variables (do this for both "Production" and
// "Preview" environments, or requests from preview deploys will fail).
//
//   RESEND_API_KEY    Your Resend API key. Generate one at
//                      resend.com → API Keys. Mark this one as "Secret"
//                      (encrypted) in the Cloudflare dashboard, not a
//                      plain-text variable.
//   EVAL_ALERT_TO      The email address(es) that should receive the
//                      notification when someone submits the form.
//                      Comma-separate multiple addresses, e.g.
//                      brian@sidecarservices.com,support@sidecarservices.com,vala@sidecarservices.com
//
// You'll also need a FROM address on a domain you've verified with Resend
// (e.g. leads@sidecarservices.com) — see EVAL_FROM below and the setup
// guide for the DNS records Resend asks you to add.
//
//   EVAL_FROM          The verified "from" address Resend sends as, e.g.
//                       leads@sidecarservices.com. Falls back to
//                       onboarding@resend.dev (Resend's shared test address,
//                       which only delivers to your own Resend account
//                       email) if unset — fine for testing, not for
//                       production.
//
// For local testing with `wrangler pages dev`, copy .dev.vars.example to
// .dev.vars and fill in real values there instead (that file is gitignored).
// ──────────────────────────────────────────────────────────────────────────

const RESEND_API_URL = 'https://api.resend.com/emails';

export async function onRequestPost(context) {
  const { request, env } = context;

  let formData;
  try {
    formData = await request.formData();
  } catch (err) {
    return errorRedirect(request, 'invalid');
  }

  // Honeypot: a real visitor never sees or fills this field (see home.html
  // and the per-industry page forms). If it's filled, silently pretend
  // success so bots don't learn anything.
  const honeypot = (formData.get('company') || '').toString().trim();
  if (honeypot !== '') {
    return redirectTo(request, '/thank-you.html');
  }

  const name = (formData.get('name') || '').toString().trim();
  const email = (formData.get('email') || '').toString().trim();
  const phoneRaw = (formData.get('phone') || '').toString().trim();
  const zip = (formData.get('zip') || '').toString().trim();
  const businessName = (formData.get('businessName') || '').toString().trim();
  const propertyType = (formData.get('propertyType') || '').toString().trim();
  const details = (formData.get('details') || '').toString().trim();

  if (!name || !email || !phoneRaw || !zip || !propertyType) {
    return errorRedirect(request, 'missing');
  }

  if (!isValidEmail(email)) {
    return errorRedirect(request, 'email');
  }

  const phoneE164 = toE164(phoneRaw);
  if (!phoneE164) {
    return errorRedirect(request, 'phone');
  }

  if (!isValidZip(zip)) {
    return errorRedirect(request, 'zip');
  }

  const alertRecipients = (env.EVAL_ALERT_TO || '')
    .split(',')
    .map((a) => a.trim())
    .filter(Boolean);

  if (!env.RESEND_API_KEY || alertRecipients.length === 0) {
    console.error(
      'Evaluation form is not fully configured — missing RESEND_API_KEY or EVAL_ALERT_TO. ' +
        'Set these in Cloudflare Pages → Settings → Environment variables.'
    );
    return errorRedirect(request, 'config');
  }

  const fromAddress = env.EVAL_FROM || 'onboarding@resend.dev';

  const subject = `New Free Evaluation Request — ${businessName || name} (${propertyType})`;
  const textBody = [
    'New free on-site evaluation request from sidecarservices.com',
    '',
    `Name: ${name}`,
    `Email: ${email}`,
    `Phone: ${phoneE164}`,
    `ZIP Code: ${zip}`,
    businessName ? `Business / Property Name: ${businessName}` : null,
    `Property Type: ${propertyType}`,
    details ? `Additional Details: ${details}` : null,
  ]
    .filter((line) => line !== null)
    .join('\n');

  try {
    const resendResponse = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `Sidecar Website <${fromAddress}>`,
        to: alertRecipients,
        reply_to: email,
        subject,
        text: textBody,
      }),
    });

    if (!resendResponse.ok) {
      const errBody = await resendResponse.text().catch(() => '');
      console.error(`Resend API returned ${resendResponse.status}: ${errBody}`);
      return errorRedirect(request, 'send', `${resendResponse.status}:${errBody.slice(0, 150)}`);
    }
  } catch (err) {
    console.error('Resend API request failed:', err);
    return errorRedirect(request, 'send', String(err && err.message ? err.message : err).slice(0, 150));
  }

  return redirectTo(request, '/thank-you.html');
}

// Any non-POST method (GET, etc.) hitting this route gets a plain 405 —
// there's nothing to render at this URL, it's an endpoint, not a page.
export async function onRequestGet() {
  return new Response('Method Not Allowed', { status: 405 });
}

function redirectTo(request, path) {
  return Response.redirect(new URL(path, request.url), 303);
}

// Sends the visitor back to whichever page their form was actually on
// (read from the Referer header), with an ?error= code and #evaluation
// anchor so that page's alert box + JS can show the right message. Falls
// back to the homepage if a Referer isn't present (some privacy settings
// strip it, which is rare but shouldn't break the redirect).
function errorRedirect(request, code, detail) {
  const referer = request.headers.get('Referer');
  let pathname = '/';
  if (referer) {
    try {
      pathname = new URL(referer).pathname;
    } catch (err) {
      // Malformed Referer header — fall back to homepage.
    }
  }
  const params = new URLSearchParams({ error: code });
  if (detail) params.set('detail', detail);
  return redirectTo(request, `${pathname}?${params.toString()}#evaluation`);
}

function isValidEmail(email) {
  // Simple, permissive check — good enough to catch typos without rejecting
  // valid addresses. Real deliverability is enforced by Resend anyway.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Accepts 5-digit ZIP or ZIP+4 (e.g. 30305 or 30305-1234).
function isValidZip(zip) {
  return /^\d{5}(-\d{4})?$/.test(zip);
}

// Normalizes a user-typed US/Canada phone number to E.164 (+1XXXXXXXXXX).
// Returns null if it doesn't look like a valid 10 or 11 digit NANP number.
// (Sidecar's service area is metro Atlanta, so NANP-only is a safe default —
// widen this if the form ever needs to take international numbers.)
function toE164(raw) {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}
