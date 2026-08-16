// /api/data/inventory-lots
// GET  ?location=&productId=&all=1
//   Default: only lots with quantity_remaining != 0 (what's actually on
//   hand, positive or negative-shortfall). Pass all=1 for full purchase
//   history including fully-consumed lots (e.g. for a cost history view).
// GET  ?latestCost=1&productId=X  -> { unitCost } most recent known cost,
//   used to prefill the purchase form.
// POST -> a whole purchase BATCH at once (one or more products bought
//   together, e.g. a Costco run). Body:
//   { batchLabel, purchasedDate, vendor?, paidBy?,
//     items: [{ productId, productName, quantity, unitCost?, packagePrice?, packageQty? }] }
//   For each item: unitCost wins if given; else packagePrice/packageQty is
//   used to compute it; else it defaults to that product's most recent
//   known cost (so "nothing changed" purchases need zero price entry).
//   Each item becomes its own product_costs lot (location='main') AND its
//   own expense row (category "Inventory - Product Purchases"), linked via
//   expense_id, so the purchase shows up on both the Inventory tab and the
//   Expense Log without double counting.
// DELETE ?id=...  -> only allowed if the lot hasn't been touched yet
//   (quantity_remaining === quantity), so consumption history is never
//   silently invalidated. Also deletes the linked expense row, if any.
//
// Requires a D1 database bound as "DB". Sits behind Cloudflare Access.
// Added via migrations/008_fifo_inventory.sql — degrades gracefully if not
// run yet (falls back to the pre-FIFO product_costs shape).

import { genId, latestUnitCost } from '../_lib/fifo.js';

function isMissingColumnOrTable(err) {
  return /no such (table|column)/i.test(String(err && err.message || err));
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const productId = url.searchParams.get('productId');
  const location = url.searchParams.get('location');
  const all = url.searchParams.get('all');

  if (url.searchParams.get('latestCost') && productId) {
    try {
      const unitCost = await latestUnitCost(env, productId);
      return Response.json({ unitCost });
    } catch (err) {
      if (isMissingColumnOrTable(err)) return Response.json({ unitCost: 0 });
      return Response.json({ error: String(err.message || err) }, { status: 500 });
    }
  }

  try {
    let query = `SELECT id, product_id as productId, product_name as productName, unit_cost as unitCost,
                        quantity, quantity_remaining as quantityRemaining, location, purchased_date as purchasedDate,
                        vendor, notes, batch_label as batchLabel, expense_id as expenseId, source_lot_id as sourceLotId,
                        created_at as createdAt
                 FROM product_costs WHERE 1=1`;
    const binds = [];
    if (productId) { binds.push(productId); query += ` AND product_id = ?${binds.length}`; }
    if (location) { binds.push(location); query += ` AND location = ?${binds.length}`; }
    if (!all) query += ` AND quantity_remaining != 0`;
    query += ' ORDER BY purchased_date ASC, created_at ASC';
    const { results } = await env.DB.prepare(query).bind(...binds).all();
    return Response.json({ lots: results });
  } catch (err) {
    if (isMissingColumnOrTable(err)) {
      return Response.json({ lots: [], _migrationNeeded: 'migrations/008_fifo_inventory.sql' });
    }
    return Response.json({ error: String(err.message || err) }, { status: 500 });
  }
}

export async function onRequestPost({ request, env }) {
  const body = await request.json();
  const { batchLabel = '', purchasedDate, vendor = '', paidBy = '', items = [] } = body;
  if (!purchasedDate) return Response.json({ error: 'purchasedDate is required' }, { status: 400 });
  if (!Array.isArray(items) || !items.length) return Response.json({ error: 'At least one item is required' }, { status: 400 });

  const createdAt = new Date().toISOString();
  const results = [];

  try {
    for (const item of items) {
      const { productId, productName = '', quantity } = item;
      if (!productId || !quantity) continue;

      let unitCost = item.unitCost;
      if (unitCost === undefined || unitCost === null || unitCost === '') {
        if (item.packagePrice && item.packageQty) {
          unitCost = Number(item.packagePrice) / Number(item.packageQty);
        } else {
          unitCost = await latestUnitCost(env, productId);
        }
      }
      unitCost = Number(unitCost) || 0;

      // One expense line per product, so category/margin reporting stays
      // accurate — but they all share the batch label/vendor so they're
      // still visibly one purchase trip on the Expense Log.
      const expenseId = genId();
      await env.DB.prepare(
        `INSERT INTO expenses (id, date, category, amount, machine_id, note, vendor, paid_by, expense_type, reimbursable, reimbursed, recurring, receipt_ref)
         VALUES (?1, ?2, 'Inventory - Product Purchases', ?3, NULL, ?4, ?5, ?6, 'operating', 0, 0, '', '')`
      ).bind(expenseId, purchasedDate, unitCost * Number(quantity), batchLabel ? `${batchLabel} — ${productName}` : productName, vendor, paidBy).run();

      const lotId = genId();
      await env.DB.prepare(
        `INSERT INTO product_costs (id, product_id, product_name, unit_cost, quantity, quantity_remaining, location, purchased_date, vendor, notes, batch_label, expense_id, package_price, package_qty, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5, 'main', ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)`
      ).bind(lotId, productId, productName, unitCost, quantity, purchasedDate, vendor, '', batchLabel, expenseId,
        item.packagePrice || null, item.packageQty || null, createdAt).run();

      results.push({ lotId, expenseId, productId, productName, unitCost, quantity });
    }
  } catch (err) {
    if (isMissingColumnOrTable(err)) {
      return Response.json({ error: 'Run migrations/008_fifo_inventory.sql against the D1 database, then try again.' }, { status: 500 });
    }
    return Response.json({ error: String(err.message || err) }, { status: 500 });
  }

  return Response.json({ items: results });
}

export async function onRequestDelete({ request, env }) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return Response.json({ error: 'id query param required' }, { status: 400 });

  const lot = await env.DB.prepare('SELECT quantity, quantity_remaining, expense_id FROM product_costs WHERE id = ?1').bind(id).first();
  if (!lot) return Response.json({ error: 'Lot not found.' }, { status: 404 });
  if (lot.quantity_remaining !== lot.quantity) {
    return Response.json({ error: 'This lot has already been partly restocked, sold, or QMOS\'d — it can\'t be deleted. Delete would break the audit trail.' }, { status: 409 });
  }
  await env.DB.prepare('DELETE FROM product_costs WHERE id = ?1').bind(id).run();
  if (lot.expense_id) await env.DB.prepare('DELETE FROM expenses WHERE id = ?1').bind(lot.expense_id).run();
  return Response.json({ ok: true });
}
