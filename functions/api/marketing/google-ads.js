// /api/marketing/google-ads
// GET ?days=30  -> { connected: false, missing: [...] }  if not yet configured, or
//                  { connected: true, totalSpend, totalClicks, totalConversions, campaigns: [...] }
//
// Requires these Cloudflare secrets/vars (see DEPLOY_MARKETING.md for how to get each one):
//   GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET, GOOGLE_ADS_REFRESH_TOKEN,
//   GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_CUSTOMER_ID
// Until all five are set, this endpoint degrades to { connected: false } rather than
// erroring, so the Marketing tab can show a clean "connect this" state.

import { getGoogleAccessToken, missingEnvVars } from '../../_lib/google-oauth.js';

const REQUIRED = ['GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_SECRET', 'GOOGLE_ADS_REFRESH_TOKEN', 'GOOGLE_ADS_DEVELOPER_TOKEN', 'GOOGLE_ADS_CUSTOMER_ID'];

export async function onRequestGet({ request, env }) {
  const missing = missingEnvVars(env, REQUIRED);
  if (missing.length) {
    return Response.json({ connected: false, missing });
  }

  const url = new URL(request.url);
  const days = Math.min(parseInt(url.searchParams.get('days') || '30', 10) || 30, 365);

  try {
    const accessToken = await getGoogleAccessToken({
      clientId: env.GOOGLE_ADS_CLIENT_ID,
      clientSecret: env.GOOGLE_ADS_CLIENT_SECRET,
      refreshToken: env.GOOGLE_ADS_REFRESH_TOKEN,
    });

    const customerId = String(env.GOOGLE_ADS_CUSTOMER_ID).replace(/-/g, '');
    // Google Ads' GAQL DURING clause only accepts a fixed set of relative-date literals —
    // LAST_7_DAYS / LAST_30_DAYS cover the two views this dashboard offers; anything else
    // would need explicit BETWEEN 'YYYY-MM-DD' AND 'YYYY-MM-DD' bounds instead.
    const dateLiteral = days <= 7 ? 'LAST_7_DAYS' : 'LAST_30_DAYS';
    const query = `
      SELECT campaign.id, campaign.name, campaign.status,
             metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions
      FROM campaign
      WHERE segments.date DURING ${dateLiteral}
    `.trim();

    const res = await fetch(
      `https://googleads.googleapis.com/v25/customers/${customerId}/googleAds:search`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'developer-token': env.GOOGLE_ADS_DEVELOPER_TOKEN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query }),
      }
    );
    const data = await res.json();
    if (!res.ok) {
      return Response.json({ connected: true, error: 'Google Ads API error: ' + JSON.stringify(data) }, { status: 502 });
    }

    const campaigns = (data.results || []).map((r) => ({
      id: r.campaign.id,
      name: r.campaign.name,
      status: r.campaign.status,
      spend: (parseInt(r.metrics.costMicros || '0', 10)) / 1e6,
      clicks: parseInt(r.metrics.clicks || '0', 10),
      impressions: parseInt(r.metrics.impressions || '0', 10),
      conversions: parseFloat(r.metrics.conversions || '0'),
    }));
    const totalSpend = campaigns.reduce((s, c) => s + c.spend, 0);
    const totalClicks = campaigns.reduce((s, c) => s + c.clicks, 0);
    const totalConversions = campaigns.reduce((s, c) => s + c.conversions, 0);

    return Response.json({ connected: true, days, totalSpend, totalClicks, totalConversions, campaigns, syncedAt: new Date().toISOString() });
  } catch (err) {
    return Response.json({ connected: true, error: String(err.message || err) }, { status: 500 });
  }
}
