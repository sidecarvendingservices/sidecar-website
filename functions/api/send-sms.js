// POST /api/send-sms
// body: { to, toName?, message, machineId? }
//
// Sends a text through OpenPhone's (now branded "Quo") API, so property
// manager texts can be sent straight from the "Text PM" button on a
// machine's detail view.
//
// Required Cloudflare Pages environment variables (Secrets, Production + Preview):
//   OPENPHONE_API_KEY    - from OpenPhone Settings -> API. Sent as a raw
//                          value in the Authorization header (OpenPhone does
//                          not use a "Bearer " prefix).
//   OPENPHONE_FROM_NUMBER - the OpenPhone number to send from, in E.164
//                           format (e.g. +14045551234).
//
// NOTE: this endpoint is un-tested against a live OpenPhone account (none
// exists yet) — the request shape follows OpenPhone's documented "Send a
// message" API (POST https://api.openphone.com/v1/messages), but should be
// smoke-tested with a real OPENPHONE_API_KEY once the account is set up.

export async function onRequestPost({ request, env }) {
  const body = await request.json();
  const { to, toName = '', message } = body;
  if (!to || !message) {
    return Response.json({ ok: false, error: 'to and message are required' }, { status: 400 });
  }

  if (!env.OPENPHONE_API_KEY || !env.OPENPHONE_FROM_NUMBER) {
    return Response.json({
      ok: false,
      error: 'Texting isn\'t set up yet — add OPENPHONE_API_KEY and OPENPHONE_FROM_NUMBER as secrets on this Pages project once you\'ve created an OpenPhone/Quo account.',
    }, { status: 503 });
  }

  try {
    const res = await fetch('https://api.openphone.com/v1/messages', {
      method: 'POST',
      headers: {
        'Authorization': env.OPENPHONE_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.OPENPHONE_FROM_NUMBER,
        to: [to],
        content: message,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return Response.json({ ok: false, error: `OpenPhone error (${res.status}): ${JSON.stringify(data)}` }, { status: 502 });
    }
    return Response.json({ ok: true, sentTo: to, toName });
  } catch (err) {
    return Response.json({ ok: false, error: String(err.message || err) }, { status: 502 });
  }
}
