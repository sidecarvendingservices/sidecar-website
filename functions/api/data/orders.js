// /api/data/orders
// GET ?machineId=&date=&start=&end=&limit=   -> { orders: [{ ...order, items: [...] }] }
//     Drives the order drill-down modal (click a machine or a date in the
//     Sales Log) and the pay-period order-count tracker.
// GET ?stats=1&month=YYYY-MM                  -> { orderCount, byMachine: {machineId: count} }
//     Note: HAHA's API does not expose any buyer/card/loyalty identifier on
//     an order, so a real "unique shoppers" count can't be derived from this
//     data — only order (transaction) counts are meaningful here.
// POST (sync, bulk idempotent replace): {
//   sync: true, machineId, start, end,
//   orders: [ { id, orderDtm, date, gross, net, status, isRefund,
//               items: [{ productId, productName, quantity, price, itemTotal }] }, ... ]
// }
//   Deletes existing source='haha' orders for that machine within [start, end]
//   (and their items), then inserts the fresh ones.
//
// Requires a D1 database bound as "DB". Sits behind Cloudflare Access.

function genId() {
  return crypto.randomUUID();
}
function isMissingTableError(err) {
  return /no such table/i.test(String(err && err.message || err));
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const machineId = url.searchParams.get('machineId');
  const date = url.searchParams.get('date');
  const start = url.searchParams.get('start');
  const end = url.searchParams.get('end');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '200', 10) || 200, 1000);

  try {
    if (url.searchParams.get('stats') === '1') {
      const month = url.searchParams.get('month');
      let query = `SELECT machine_id as machineId, COUNT(*) as n FROM orders WHERE is_refund = 0`;
      const binds = [];
      if (month) { binds.push(month + '%'); query += ` AND date LIKE ?${binds.length}`; }
      query += ' GROUP BY machine_id';
      const { results } = await env.DB.prepare(query).bind(...binds).all();
      const byMachine = {};
      let orderCount = 0;
      results.forEach((r) => { byMachine[r.machineId] = r.n; orderCount += r.n; });
      return Response.json({ orderCount, byMachine });
    }

    let query = `SELECT id, machine_id as machineId, order_dtm as orderDtm, date, gross, net, status, is_refund as isRefund, source
                 FROM orders WHERE 1=1`;
    const binds = [];
    if (machineId) { binds.push(machineId); query += ` AND machine_id = ?${binds.length}`; }
    if (date) { binds.push(date); query += ` AND date = ?${binds.length}`; }
    if (start) { binds.push(start); query += ` AND date >= ?${binds.length}`; }
    if (end) { binds.push(end); query += ` AND date <= ?${binds.length}`; }
    query += ' ORDER BY order_dtm DESC';
    binds.push(limit);
    query += ` LIMIT ?${binds.length}`;

    const { results: orderRows } = await env.DB.prepare(query).bind(...binds).all();
    if (!orderRows.length) return Response.json({ orders: [] });

    const ids = orderRows.map((o) => o.id);
    const placeholders = ids.map((_, i) => `?${i + 1}`).join(',');
    const { results: itemRows } = await env.DB.prepare(
      `SELECT order_id as orderId, product_id as productId, product_name as productName, quantity, price, item_total as itemTotal
       FROM order_items WHERE order_id IN (${placeholders})`
    ).bind(...ids).all();

    const itemsByOrder = {};
    itemRows.forEach((it) => {
      (itemsByOrder[it.orderId] = itemsByOrder[it.orderId] || []).push(it);
    });
    const orders = orderRows.map((o) => ({ ...o, isRefund: !!o.isRefund, items: itemsByOrder[o.id] || [] }));
    return Response.json({ orders });
  } catch (err) {
    if (isMissingTableError(err)) {
      return Response.json({ orders: [], orderCount: 0, byMachine: {}, _migrationNeeded: 'migrations/004_orders_inventory_service.sql' });
    }
    return Response.json({ error: String(err.message || err) }, { status: 500 });
  }
}

export async function onRequestPost({ request, env }) {
  const body = await request.json();
  const { machineId, start, end, orders = [] } = body;
  if (!machineId || !start || !end) {
    return Response.json({ error: 'machineId, start, and end are required' }, { status: 400 });
  }

  try {
    const { results: existing } = await env.DB.prepare(
      `SELECT id FROM orders WHERE machine_id = ?1 AND source = 'haha' AND date >= ?2 AND date <= ?3`
    ).bind(machineId, start, end).all();
    if (existing.length) {
      const existIds = existing.map((r) => r.id);
      const ph = existIds.map((_, i) => `?${i + 1}`).join(',');
      await env.DB.prepare(`DELETE FROM order_items WHERE order_id IN (${ph})`).bind(...existIds).run();
    }
    await env.DB.prepare(
      `DELETE FROM orders WHERE machine_id = ?1 AND source = 'haha' AND date >= ?2 AND date <= ?3`
    ).bind(machineId, start, end).run();

    const orderStmts = orders.map((o) =>
      env.DB.prepare(
        `INSERT INTO orders (id, machine_id, order_dtm, date, gross, net, status, is_refund, source)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'haha')`
      ).bind(o.id, machineId, o.orderDtm, o.date, o.gross || 0, o.net || 0, o.status || null, o.isRefund ? 1 : 0)
    );
    if (orderStmts.length) await env.DB.batch(orderStmts);

    const itemStmts = [];
    orders.forEach((o) => {
      (o.items || []).forEach((it) => {
        itemStmts.push(
          env.DB.prepare(
            `INSERT INTO order_items (id, order_id, machine_id, product_id, product_name, quantity, price, item_total)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`
          ).bind(genId(), o.id, machineId, it.productId || null, it.productName || null, it.quantity || 0, it.price || null, it.itemTotal || null)
        );
      });
    });
    if (itemStmts.length) await env.DB.batch(itemStmts);

    return Response.json({ ok: true, inserted: orderStmts.length });
  } catch (err) {
    if (isMissingTableError(err)) {
      return Response.json({
        ok: false,
        error: 'The orders table doesn\'t exist yet — run migrations/004_orders_inventory_service.sql against the D1 database, then try again.',
      });
    }
    return Response.json({ ok: false, error: String(err.message || err) }, { status: 500 });
  }
}
