// /api/data/product-costs
// GET  ?productId=          -> { costs: [...] }  (all products if omitted)
//   Every purchase/lot is kept as its own row (FIFO-style ledger) so cost
//   changes over time stay visible instead of a single cost getting
//   silently overwritten. The Products tab uses the most recent row per
//   product (by purchased_date) as "current cost".
// POST { productId, productName, unitCost, quantity, purchasedDate, vendor?, notes? }
//   Always inserts a new lot — this is a ledger, not an upsert.
// DELETE ?id=...
//
// Requires a D1 database bound as "DB". Sits behind Cloudflare Access.
// Added via migrations/007_products.sql — this file degrades gracefully
// (returns _migrationNeeded) if that hasn't been run yet.

function genId() {
  return crypto.randomUUID();
}
function isMissingTableError(err) {
  return /no such table/i.test(String(err && err.message || err));
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const productId = url.searchParams.get('productId');
  try {
    let query = `SELECT id, product_id as productId, product_name as productName, unit_cost as unitCost,
                        quantity, purchased_date as purchasedDate, vendor, notes, created_at as createdAt
                 FROM product_costs WHERE 1=1`;
    const binds = [];
    if (productId) { binds.push(productId); query += ` AND product_id = ?${binds.length}`; }
    query += ' ORDER BY purchased_date DESC, created_at DESC';
    const { results } = await env.DB.prepare(query).bind(...binds).all();
    return Response.json({ costs: results });
  } catch (err) {
    if (isMissingTableError(err)) {
      return Response.json({ costs: [], _migrationNeeded: 'migrations/007_products.sql' });
    }
    return Response.json({ error: String(err.message || err) }, { status: 500 });
  }
}

export async function onRequestPost({ request, env }) {
  const body = await request.json();
  const { productId, productName = '', unitCost, quantity, purchasedDate, vendor = '', notes = '' } = body;
  if (!productId || unitCost === undefined || unitCost === null || !quantity || !purchasedDate) {
    return Response.json({ error: 'productId, unitCost, quantity, and purchasedDate are required' }, { status: 400 });
  }
  try {
    const id = genId();
    const createdAt = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO product_costs (id, product_id, product_name, unit_cost, quantity, purchased_date, vendor, notes, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`
    ).bind(id, productId, productName, unitCost, quantity, purchasedDate, vendor, notes, createdAt).run();
    return Response.json({ id, productId, productName, unitCost, quantity, purchasedDate, vendor, notes, createdAt });
  } catch (err) {
    if (isMissingTableError(err)) {
      return Response.json({ error: 'The product_costs table doesn\'t exist yet — run migrations/007_products.sql, then try again.' }, { status: 500 });
    }
    return Response.json({ error: String(err.message || err) }, { status: 500 });
  }
}

export async function onRequestDelete({ request, env }) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return Response.json({ error: 'id query param required' }, { status: 400 });
  await env.DB.prepare('DELETE FROM product_costs WHERE id = ?1').bind(id).run();
  return Response.json({ ok: true });
}
