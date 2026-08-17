// /api/data/inventory-adjustment
// POST -> body: { productId, productName, quantity, unitCost?, reason? }
//   v1.10.2 §5 — Negative Backstock shrink/inventory adjustment. Creates a
//   plain product_costs lot (location='main'), same table every purchase
//   lot already lives in — no schema change needed, since FIFO consumption
//   and backstockAggregated() on the client already just sum
//   quantity_remaining across every lot for a product, whatever created it.
//   `quantity` can be POSITIVE (correcting a negative/shortfall balance —
//   e.g. found stock that was never logged in) or NEGATIVE (recording
//   genuine shrink/loss on positive stock — breakage, theft, expired and
//   tossed outside the QMOS flow). unitCost defaults to $0 (adjustments
//   usually have no real purchase cost) but is editable — set it when the
//   adjustment should carry a real cost basis (e.g. correcting a lot that
//   really was purchased but never logged).
//   Tagged via batch_label = 'Inventory Adjustment' so it's identifiable
//   in the Backstock table and cost-lot history, distinct from a real
//   purchase.
//
// Requires a D1 database bound as "DB". Sits behind Cloudflare Access.
// Same product_costs table as migrations/008_fifo_inventory.sql.

function genId() {
  return 'adj_' + crypto.randomUUID();
}
function isMissingColumnOrTable(err) {
  return /no such (table|column)/i.test(String(err && err.message || err));
}

export async function onRequestPost({ request, env }) {
  const body = await request.json();
  const { productId, productName = '', quantity, unitCost = 0, reason = '' } = body;
  if (!productId || quantity === undefined || quantity === null || Number(quantity) === 0) {
    return Response.json({ error: 'productId and a non-zero quantity are required' }, { status: 400 });
  }
  const id = genId();
  const createdAt = new Date().toISOString();
  const today = new Date().toISOString().slice(0, 10);
  try {
    await env.DB.prepare(
      `INSERT INTO product_costs (id, product_id, product_name, unit_cost, quantity, quantity_remaining, location, purchased_date, vendor, notes, batch_label, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?5, 'main', ?6, '', ?7, 'Inventory Adjustment', ?8)`
    ).bind(id, productId, productName, Number(unitCost) || 0, Number(quantity), today, reason || '', createdAt).run();
  } catch (err) {
    if (isMissingColumnOrTable(err)) {
      return Response.json({ error: 'Run migrations/008_fifo_inventory.sql against the D1 database, then try again.' }, { status: 500 });
    }
    return Response.json({ error: String(err.message || err) }, { status: 500 });
  }
  return Response.json({ id, productId, productName, quantity: Number(quantity), unitCost: Number(unitCost) || 0 });
}
