// TEMPORARY diagnostic endpoint — added to debug why Cf-Access-Authenticated-User-Email
// isn't showing up in whoami.js despite Access successfully challenging/authenticating.
// Dumps every request header the Function actually receives, so we can see exactly what
// Cloudflare is (or isn't) forwarding, instead of guessing. Safe to delete once resolved —
// this only echoes header names/values back to whoever can already reach this URL (which,
// once Access is working, is only you/Vala; while we're debugging it may be reachable more
// broadly, but it doesn't expose anything from the database or app itself).
export async function onRequestGet({ request }) {
  const headers = {};
  for (const [key, value] of request.headers.entries()) {
    headers[key] = value;
  }
  return Response.json({
    url: request.url,
    headers,
  });
}
