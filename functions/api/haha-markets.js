// GET /api/haha-markets
//
// Proxies HAHA's Get Market List endpoint — returns every device (machine)
// registered under the merchant account, so the dashboard can offer them as
// a pick-list instead of you typing marketId strings by hand.

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

    while (all.length < total && page <= 20) { // 20-page safety cap (2,000 machines)
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

    return jsonResponse({ ok: true, count: all.length, markets: all });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err.message || err) }, 502);
  }
}
