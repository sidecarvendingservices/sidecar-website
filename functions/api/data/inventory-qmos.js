// /api/data/inventory-qmos
// POST { location, productId, productName, quantity, reason, date, notes? }
//   location: 'main' (backstock) or a machine id.
//   reason: 'quality' | 'sample' | 'expired'
//   QMOS = "Quantity Mark Out of System" — quality issues (crushed bag,
//   got wet), samples given away, or expired product. FIFO-consumes the
//   oldest lot(s) at that location for the product, and auto-creates a
//   linked expense (category "Inventory - Shrinkage & Waste (QMOS)") at
//   the FIFO cost of the units removed, so write-offs show up in Expense
//   Breakdown and machine P&L like any other cost.
// GET ?since=&until=&location=&machineId=  -> { log: [...] } the QMOS
//   history (inventory_moves rows where type='qmos'), for the running log
//   + weekly/monthly/quarterly totals view.
// DELETE ?refId=...  -> v1.10.2 §4. Reverses the FIFO draw: adds each
//   drawn quantity back onto its source lot's quantity_remaining, deletes
//   the linked expense, deletes the inventory_moves rows for this refId.
//   Editing a QMOS entry is implemented client-side as delete-then-recreate
//   (DELETE this refId, then POST the edited values) rather than an
//   in-place update — a QMOS quantity/reason/date change can legitimately
//   draw from different lots than the original did, so re-running the real
//   FIFO logic is more correct than trying to patch the old draw in place.
//
// Requires a D1 database bound as "DB". Sits behind Cloudflare Access.
// Added via migrations/008_fifo_inventory.sql.

import { genId, consumeFifo, logMoves } from '../../_lib/fifo.js';

function isMissingColumnOrTable(err) {
  return /no such (table|column)/i.test(String(err && err.message || err));
}

const REASON_LABELS = { quality: 'Quality', sample: 'Sample', expired: 'Expired' };

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const since = url.searchParams.get('since');
  const until = url.searchParams.get('until');
  const location = url.searchParams.get('location');
  const machineId = url.searchParams.get('machineId');
  try {
    let query = `SELECT id, lot_id as lotId, from_location as fromLocation, machine_id as machineId,
                        product_id as productId, product_name as productName, quantity, unit_cost as unitCost,
                        reason, ref_id as refId, expense_id as expenseId, date, notes, created_at as createdAt
                 FROM inventory_moves WHERE type = 'qmos'`;
    const binds = [];
    if (since) { binds.push(since); query += ` AND date >= ?${binds.length}`; }
    if (until) { binds.push(until); query += ` AND date <= ?${binds.length}`; }
    if (location) { binds.push(location); query += ` AND from_location = ?${binds.length}`; }
    if (machineId) { binds.push(machineId); query += ` AND machine_id = ?${binds.length}`; }
    query += ' ORDER BY date DESC, created_at DESC';
    const { results } = await env.DB.prepare(query).bind(...binds).all();
    return Response.json({ log: results });
  } catch (err) {
    if (isMissingColumnOrTable(err)) return Response.json({ log: [], _migrationNeeded: 'migrations/008_fifo_inventory.sql' });
    return Response.json({ error: String(err.message || err) }, { status: 500 });
  }
}

export async function onRequestPost({ request, env }) {
  const body = await request.json();
  const { location, productId, productName = '', quantity, reason, date, notes = '' } = body;
  if (!location || !productId || !quantity || !reason || !date) {
    return Response.json({ error: 'location, productId, quantity, reason, and date are required' }, { status: 400 });
  }
  if (!REASON_LABELS[reason]) return Response.json({ error: 'reason must be quality, sample, or expired' }, { status: 400 });

  try {
    const refId = genId();
    const { draws, shortfall } = await consumeFifo(env, { productId, productName, location, quantity: Number(quantity), date });
    const totalCost = draws.reduce((s, d) => s + d.quantity * d.unitCost, 0);

    const expenseId = genId();
    const locLabel = location === 'main' ? 'Backstock' : 'Machine';
    await env.DB.prepare(
      `INSERT INTO expenses (id, date, category, amount, machine_id, note, vendor, paid_by, expense_type, reimbursable, reimbursed, recurring, receipt_ref)
       VALUES (?1, ?2, 'Inventory - Shrinkage & Waste (QMOS)', ?3, ?4, ?5, '', '', 'operating', 0, 0, '', '')`
    ).bind(expenseId, date, totalCost, location === 'main' ? null : location,
      `QMOS (${REASON_LABELS[reason]}) — ${productName || productId} x${quantity}, ${locLabel}${notes ? ': ' + notes : ''}`).run();

    await logMoves(env, {
      draws, type: 'qmos', fromLocation: location, machineId: location === 'main' ? null : location,
      productId, productName, reason, refId, expenseId, date, notes,
    });

    return Response.json({ ok: true, refId, expenseId, quantityRemoved: Number(quantity), totalCost, shortfall });
  } catch (err) {
    if (isMissingColumnOrTable(err)) {
      return Response.json({ error: 'Run migrations/008_fifo_inventory.sql against the D1 database, then try again.' }, { status: 500 });
    }
    return Response.json({ error: String(err.message || err) }, { status: 500 });
  }
}

export async function onRequestDelete({ request, env }) {
  const url = new URL(request.url);
  const refId = url.searchParams.get('refId');
  if (!refId) return Response.json({ error: 'refId query param required' }, { status: 400 });

  try {
    const { results: moves } = await env.DB.prepare(
      `SELECT id, lot_id as lotId, quantity, expense_id as expenseId FROM inventory_moves WHERE ref_id = ?1 AND type = 'qmos'`
    ).bind(refId).all();
    if (!moves.length) return Response.json({ error: 'QMOS entry not found' }, { status: 404 });

    const stmts = [];
    // Reverse each draw — add the quantity back onto the lot it came from.
    // Works correctly for an auto-created shortfall lot too: adding back
    // moves its (negative) quantity_remaining back toward zero, same as
    // any other lot.
    for (const m of moves) {
      stmts.push(env.DB.prepare(`UPDATE product_costs SET quantity_remaining = quantity_remaining + ?1 WHERE id = ?2`).bind(m.quantity, m.lotId));
    }
    stmts.push(env.DB.prepare(`DELETE FROM inventory_moves WHERE ref_id = ?1 AND type = 'qmos'`).bind(refId));
    const expenseId = moves[0].expenseId;
    if (expenseId) stmts.push(env.DB.prepare(`DELETE FROM expenses WHERE id = ?1`).bind(expenseId));
    await env.DB.batch(stmts);
    return Response.json({ ok: true });
  } catch (err) {
    if (isMissingColumnOrTable(err)) {
      return Response.json({ error: 'Run migrations/008_fifo_inventory.sql against the D1 database, then try again.' }, { status: 500 });
    }
    return Response.json({ error: String(err.message || err) }, { status: 500 });
  }
}
