// GET /api/haha-products
//
// Proxies HAHA's Get Product Catalogue endpoint. Returns every on-sale product,
// including its wholesale `cost` — this is what lets the dashboard compute real
// Cost of Goods automatically instead of requiring manual entry per sale.

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

    while (all.length < total && page <= 50) { // 50-page safety cap (5,000 products)
      const data = await hahaGet(env, '/open/api/v1/products', {
        page,
        page_size,
        sort: 'create_time_asc',
      });
      all = all.concat(data.list || []);
      total = data.total ?? all.length;
      if (!data.list || data.list.length < page_size) break;
      page += 1;
    }

    return jsonResponse({ ok: true, count: all.length, products: all });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err.message || err) }, 502);
  }
}
