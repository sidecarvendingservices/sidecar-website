// /api/data/inventory-restock
// POST { machineId, productId, productName, quantity, date, notes? }
//   Moves `quantity` units of a product from backstock ("main") into a
//   machine: FIFO-consumes the oldest backstock lots for that product,
//   then creates a new lot at the machine's location with the same
//   unit_cost/age (so FIFO ordering carries over), preserving cost basis.
//   If backstock doesn't have enough on hand, the shortfall is still
//   fulfilled (see functions/_lib/fifo.js) — backstock just goes negative,
//   which is visible on the Backstock pill rather than silently blocked.
// GET ?machineId=  -> { stock: [...] } current lot-tracked quantity per
//   product at that machine (sum of quantity_remaining, grouped by product),
//   for the Machine Inventory pill's cost-basis display.
//
// Requires a D1 database bound as "DB". Sits behind Cloudflare Access.
// Added via migrations/008_fifo_inventory.sql.

import { genId, consumeFifo, logMoves } from '../_lib/fifo.js';

function isMissingColumnOrTable(err) {
  return /no such (table|column)/i.test(String(err && err.message || err));
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const machineId = url.searchParams.get('machineId');
  if (!machineId) return Response.json({ error: 'machineId query param required' }, { status: 400 });
  try {
    const { results } = await env.DB.prepare(
      `SELECT product_id as productId, product_name as productName,
              SUM(quantity_remaining) as quantityRemaining, MIN(purchased_date) as oldestLotDate,
              AVG(unit_cost) as avgUnitCost
       FROM product_costs WHERE location = ?1 GROUP BY product_id, product_name HAVING SUM(quantity_remaining) != 0`
    ).bind(machineId).all();
    return Response.json({ stock: results });
  } catch (err) {
    if (isMissingColumnOrTable(err)) return Response.json({ stock: [], _migrationNeeded: 'migrations/008_fifo_inventory.sql' });
    return Response.json({ error: String(err.message || err) }, { status: 500 });
  }
}

export async function onRequestPost({ request, env }) {
  const body = await request.json();
  const { machineId, productId, productName = '', quantity, date, notes = '' } = body;
  if (!machineId || !productId || !quantity || !date) {
    return Response.json({ error: 'machineId, productId, quantity, and date are required' }, { status: 400 });
  }

  try {
    const refId = genId();
    const { draws, shortfall } = await consumeFifo(env, { productId, productName, location: 'main', quantity: Number(quantity), date });

    // Consume from "main" (backstock draws down).
    await logMoves(env, {
      draws, type: 'restock', fromLocation: 'main', toLocation: machineId, machineId,
      productId, productName, refId, date, notes,
    });

    // Create the matching machine-side lot(s) — one per source lot, so cost
    // and age both carry over intact (a restock can blend multiple
    // backstock purchase dates/costs into one machine, same as it would
    // physically).
    const createdAt = new Date().toISOString();
    for (const d of draws) {
      const srcLot = await env.DB.prepare('SELECT purchased_date FROM product_costs WHERE id = ?1').bind(d.lotId).first();
      const newLotId = genId();
      await env.DB.prepare(
        `INSERT INTO product_costs (id, product_id, product_name, unit_cost, quantity, quantity_remaining, location, purchased_date, vendor, notes, source_lot_id, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?6, ?7, NULL, ?8, ?9, ?10)`
      ).bind(newLotId, productId, productName, d.unitCost, d.quantity, machineId,
        srcLot ? srcLot.purchased_date : date, notes, d.lotId, createdAt).run();
    }

    return Response.json({ ok: true, refId, quantityMoved: Number(quantity), shortfall, lotsDrawn: draws.length });
  } catch (err) {
    if (isMissingColumnOrTable(err)) {
      return Response.json({ error: 'Run migrations/008_fifo_inventory.sql against the D1 database, then try again.' }, { status: 500 });
    }
    return Response.json({ error: String(err.message || err) }, { status: 500 });
  }
}
