// GET /api/haha-sales?sticker_num=B144835&start_time=2026-08-01&end_time=2026-08-09
//
// Proxies HAHA's Get Sales List endpoint. Pulls every page and returns the combined
// list, so the dashboard doesn't have to handle HAHA's cursor pagination itself.
//
// Query params (all optional, passed straight through to HAHA):
//   sticker_num  - HAHA marketId / device serial number, filters to one machine
//   start_time   - YYYY-MM-DD, payment date range start
//   end_time     - YYYY-MM-DD, payment date range end
//   status       - order status filter, defaults to PAID

import { hahaGet, jsonResponse, corsHeaders } from '../_lib/haha.js';

export async function onRequestOptions() {
  return new Response(null, { headers: corsHeaders() });
}

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const sticker_num = url.searchParams.get('sticker_num') || undefined;
    const start_time = url.searchParams.get('start_time') || undefined;
    const end_time = url.searchParams.get('end_time') || undefined;
    const status = url.searchParams.get('status') || 'PAID';

    let page = 1;
    const page_size = 100;
    let all = [];
    let total = Infinity;

    while (all.length < total && page <= 50) { // 50-page safety cap (5,000 orders)
      const data = await hahaGet(env, '/open/api/v1/sales', {
        sticker_num,
        start_time,
        end_time,
        status,
        page,
        page_size,
        sort: 'pay_time_asc',
      });
      all = all.concat(data.list || []);
      total = data.total ?? all.length;
      if (!data.list || data.list.length < page_size) break;
      page += 1;
    }

    return jsonResponse({ ok: true, count: all.length, sales: all });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err.message || err) }, 502);
  }
}
