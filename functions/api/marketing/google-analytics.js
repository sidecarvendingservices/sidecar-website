// /api/marketing/google-analytics
// GET ?days=30  -> { connected: false, missing: [...] }  if not yet configured, or
//                  { connected: true, totalSessions, totalUsers, totalPageviews, byDay: [...],
//                    topPages: [...] }
//
// Requires these Cloudflare secrets/vars (see DEPLOY_MARKETING.md for how to get each one):
//   GA4_CLIENT_ID, GA4_CLIENT_SECRET, GA4_REFRESH_TOKEN, GA4_PROPERTY_ID
// Until all four are set, this endpoint degrades to { connected: false } rather than
// erroring, so the Marketing tab can show a clean "connect this" state.

import { getGoogleAccessToken, missingEnvVars } from '../../_lib/google-oauth.js';

const REQUIRED = ['GA4_CLIENT_ID', 'GA4_CLIENT_SECRET', 'GA4_REFRESH_TOKEN', 'GA4_PROPERTY_ID'];

export async function onRequestGet({ request, env }) {
  const missing = missingEnvVars(env, REQUIRED);
  if (missing.length) {
    return Response.json({ connected: false, missing });
  }

  const url = new URL(request.url);
  const days = Math.min(parseInt(url.searchParams.get('days') || '30', 10) || 30, 365);

  try {
    const accessToken = await getGoogleAccessToken({
      clientId: env.GA4_CLIENT_ID,
      clientSecret: env.GA4_CLIENT_SECRET,
      refreshToken: env.GA4_REFRESH_TOKEN,
    });

    const propertyId = env.GA4_PROPERTY_ID;
    const runReport = async (body) => {
      const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error('GA4 API error: ' + JSON.stringify(data));
      return data;
    };

    const dateRange = [{ startDate: `${days}daysAgo`, endDate: 'today' }];

    const [byDayData, topPagesData] = await Promise.all([
      runReport({
        dateRanges: dateRange,
        dimensions: [{ name: 'date' }],
        metrics: [{ name: 'sessions' }, { name: 'totalUsers' }, { name: 'screenPageViews' }],
        orderBys: [{ dimension: { dimensionName: 'date' } }],
      }),
      runReport({
        dateRanges: dateRange,
        dimensions: [{ name: 'pagePath' }],
        metrics: [{ name: 'screenPageViews' }],
        orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
        limit: 10,
      }),
    ]);

    const byDay = (byDayData.rows || []).map((r) => ({
      date: `${r.dimensionValues[0].value.slice(0, 4)}-${r.dimensionValues[0].value.slice(4, 6)}-${r.dimensionValues[0].value.slice(6, 8)}`,
      sessions: parseInt(r.metricValues[0].value, 10),
      users: parseInt(r.metricValues[1].value, 10),
      pageviews: parseInt(r.metricValues[2].value, 10),
    }));
    const topPages = (topPagesData.rows || []).map((r) => ({
      path: r.dimensionValues[0].value,
      pageviews: parseInt(r.metricValues[0].value, 10),
    }));

    const totalSessions = byDay.reduce((s, d) => s + d.sessions, 0);
    const totalUsers = byDay.reduce((s, d) => s + d.users, 0);
    const totalPageviews = byDay.reduce((s, d) => s + d.pageviews, 0);

    return Response.json({ connected: true, days, totalSessions, totalUsers, totalPageviews, byDay, topPages, syncedAt: new Date().toISOString() });
  } catch (err) {
    return Response.json({ connected: true, error: String(err.message || err) }, { status: 500 });
  }
}
