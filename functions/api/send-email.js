// POST /api/send-email
// body: { to, toName?, subject, message, machineId? }
//
// Sends an email through Zoho Mail's API on Brian's behalf (from
// brian@sidecarservices.com), so property manager emails can be sent
// straight from the "Email PM" button on a machine's detail view.
//
// Required Cloudflare Pages environment variables (Secrets, Production + Preview):
//   ZOHO_MAIL_ACCOUNT_ID  - the numeric accountId for the sending mailbox.
//                           Find it via GET https://mail.zoho.com/api/accounts
//                           (see https://www.zoho.com/mail/help/api/get-user-account-details.html)
//   ZOHO_MAIL_OAUTH_TOKEN - a Zoho OAuth access token with the ZohoMail.messages.CREATE
//                           scope. Zoho access tokens expire (~1hr) — for a
//                           standing integration you'd normally exchange a
//                           refresh token for a fresh access token on each
//                           call. This first pass expects a token already in
//                           hand; refresh-token support is a follow-up once
//                           the account is set up and this has been tested live.
// Optional:
//   ZOHO_MAIL_FROM_ADDRESS - defaults to brian@sidecarservices.com
//
// NOTE: this endpoint is un-tested against a live Zoho account (none exists
// yet) — the request shape follows Zoho's documented "Send an Email" API
// (POST /api/accounts/{accountId}/messages), but should be smoke-tested with
// a real ZOHO_MAIL_ACCOUNT_ID / ZOHO_MAIL_OAUTH_TOKEN before relying on it.

export async function onRequestPost({ request, env }) {
  const body = await request.json();
  const { to, toName = '', subject, message } = body;
  if (!to || !subject || !message) {
    return Response.json({ ok: false, error: 'to, subject, and message are required' }, { status: 400 });
  }

  if (!env.ZOHO_MAIL_ACCOUNT_ID || !env.ZOHO_MAIL_OAUTH_TOKEN) {
    return Response.json({
      ok: false,
      error: 'Email isn\'t set up yet — add ZOHO_MAIL_ACCOUNT_ID and ZOHO_MAIL_OAUTH_TOKEN as secrets on this Pages project once the Zoho Mail API access is configured.',
    }, { status: 503 });
  }

  const fromAddress = env.ZOHO_MAIL_FROM_ADDRESS || 'brian@sidecarservices.com';

  try {
    const res = await fetch(`https://mail.zoho.com/api/accounts/${env.ZOHO_MAIL_ACCOUNT_ID}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Zoho-oauthtoken ${env.ZOHO_MAIL_OAUTH_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fromAddress,
        toAddress: to,
        subject,
        content: message,
        askReceipt: 'no',
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return Response.json({ ok: false, error: `Zoho Mail error (${res.status}): ${JSON.stringify(data)}` }, { status: 502 });
    }
    return Response.json({ ok: true, sentTo: to, toName });
  } catch (err) {
    return Response.json({ ok: false, error: String(err.message || err) }, { status: 502 });
  }
}
