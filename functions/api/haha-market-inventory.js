// GET /api/haha-market-inventory
//
// Proxies HAHA's Get Product Inventory List endpoint (/open/api/v1/inventory/products)
// and reshapes it from "per product, listing every market" to "per market
// (machine), listing every product" — which is what the Machine Detail view
// needs to show one machine's current stock levels.
//
// Also passes through productImage, so the dashboard can show product photos.

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

    while (all.length < total && page <= 50) {
      const data = await hahaGet(env, '/open/api/v1/inventory/products', {
        page,
        page_size,
        sort: 'create_time_asc',
      });
      all = all.concat(data.list || []);
      total = data.total ?? all.length;
      if (!data.list || data.list.length < page_size) break;
      page += 1;
    }

    // Reshape: byMarket[marketId] = [{ productId, productName, productImage, alias, stock }, ...]
    const byMarket = {};
    all.forEach((p) => {
      (p.markets || []).forEach((mk) => {
        if (!byMarket[mk.marketId]) byMarket[mk.marketId] = [];
        byMarket[mk.marketId].push({
          productId: p.productId,
          productName: p.productName,
          productImage: p.productImage || null,
          alias: p.alias || null,
          stock: mk.stock || 0,
        });
      });
    });

    return jsonResponse({ ok: true, byMarket, productCount: all.length });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err.message || err) }, 502);
  }
}
