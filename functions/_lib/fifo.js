// Shared FIFO lot-consumption logic, used by inventory-restock.js and
// inventory-qmos.js (and eventually sale-side COGS, if/when that's wired
// up). Draws from the oldest `purchased_date` lots first at a given
// location, decrementing quantity_remaining on each.
//
// If there isn't enough positive stock to cover the requested quantity,
// this does NOT block — it creates one additional "shortfall" lot at that
// location with a negative quantity_remaining, using the most recent known
// unit_cost for that product (or 0 if there's no cost history yet at all).
// This is deliberate: negative backstock is an expected, visible state
// while testing the workflow with real historical data (see the "starting
// inventory" seeding task) or any time a restock gets logged after the
// fact. It's surfaced in the UI rather than hidden.

export function genId() {
  return crypto.randomUUID();
}

// Returns the most recent unit_cost on record for a product, regardless of
// location — used both for "prefill the purchase form" and as the cost
// basis for an auto-created shortfall lot.
export async function latestUnitCost(env, productId) {
  const row = await env.DB.prepare(
    `SELECT unit_cost FROM product_costs WHERE product_id = ?1 ORDER BY purchased_date DESC, created_at DESC LIMIT 1`
  ).bind(productId).first();
  return row ? row.unit_cost : 0;
}

// Consumes `quantity` units of `productId` at `location` (oldest lot
// first). Returns { draws: [{ lotId, quantity, unitCost }], shortfall }.
// `shortfall` is the portion that had to come from a newly-created negative
// lot (0 if fully covered by existing positive stock).
export async function consumeFifo(env, { productId, productName, location, quantity, date }) {
  if (quantity <= 0) return { draws: [], shortfall: 0 };

  const { results: lots } = await env.DB.prepare(
    `SELECT id, unit_cost, quantity_remaining FROM product_costs
     WHERE product_id = ?1 AND location = ?2 AND quantity_remaining > 0
     ORDER BY purchased_date ASC, created_at ASC`
  ).bind(productId, location).all();

  const draws = [];
  let remaining = quantity;

  for (const lot of lots) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, lot.quantity_remaining);
    await env.DB.prepare(`UPDATE product_costs SET quantity_remaining = quantity_remaining - ?1 WHERE id = ?2`)
      .bind(take, lot.id).run();
    draws.push({ lotId: lot.id, quantity: take, unitCost: lot.unit_cost });
    remaining -= take;
  }

  let shortfall = 0;
  if (remaining > 0) {
    shortfall = remaining;
    const cost = await latestUnitCost(env, productId);
    const id = genId();
    const createdAt = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO product_costs (id, product_id, product_name, unit_cost, quantity, quantity_remaining, location, purchased_date, vendor, notes, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`
    ).bind(id, productId, productName || '', cost, -shortfall, -shortfall, location, date, null,
      'Auto-created shortfall — not enough recorded stock at this location to cover this move.', createdAt).run();
    draws.push({ lotId: id, quantity: shortfall, unitCost: cost });
  }

  return { draws, shortfall };
}

// Records one inventory_moves row per lot drawn from a consumeFifo() call,
// all sharing the same refId so a multi-lot draw can be displayed/grouped
// as one event.
export async function logMoves(env, { draws, type, fromLocation, toLocation, machineId, productId, productName, reason, refId, expenseId, date, notes }) {
  const now = new Date().toISOString();
  const stmts = draws.map((d) =>
    env.DB.prepare(
      `INSERT INTO inventory_moves (id, lot_id, type, from_location, to_location, machine_id, product_id, product_name, quantity, unit_cost, reason, ref_id, expense_id, date, notes, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)`
    ).bind(genId(), d.lotId, type, fromLocation || null, toLocation || null, machineId || null, productId, productName || '', d.quantity, d.unitCost, reason || null, refId, expenseId || null, date, notes || '', now)
  );
  if (stmts.length) await env.DB.batch(stmts);
}
