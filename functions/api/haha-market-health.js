// GET /api/haha-market-health
//
// Proxies HAHA's Get Market List endpoint (same data source as haha-markets.js)
// but shaped for the Machine Health tab: pulls every page and returns only the
// health-relevant fields per device (online status + temperature, when present).
//
// HAHA's own docs list isOnline on every market record; temperature /
// temperatureUnit / warning thresholds are confirmed present on refrigerated
// devices (see the mmsMarkets webhook payload spec) but are only returned
// here for devices that report them — non-refrigerated machines will simply
// have temperature: null.

import { hahaGet, jsonResponse, corsHeaders } from '../_lib/haha.js';

export async function onRequestOptions() {
  return new Response(null, { headers: corsHeaders() });
}

export async function onRequestGet({ env }) {
  try {
    let page = 1;
    const page_size = 100;
    let all = [];
    let total = Infinity;

    while (all.length < total && page <= 20) {
      const data = await hahaGet(env, '/open/api/v1/markets', {
        page,
        page_size,
        sort: 'create_time_asc',
      });
      all = all.concat(data.list || []);
      total = data.total ?? all.length;
      if (!data.list || data.list.length < page_size) break;
      page += 1;
    }

    const health = all.map((m) => ({
      marketId: m.marketId,
      isOnline: !!m.isOnline,
      status: m.status || null,
      temperature: m.temperature !== undefined && m.temperature !== null && m.temperature !== ''
        ? parseFloat(m.temperature) : null,
      temperatureUnit: m.temperatureUnit || null,
      warningLow: m.warningTemperatureStart ?? null,
      warningHigh: m.warningTemperatureEnd ?? null,
      updatedAt: m.updatedAt || null,
    }));

    return jsonResponse({ ok: true, count: health.length, health });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err.message || err) }, 502);
  }
}
