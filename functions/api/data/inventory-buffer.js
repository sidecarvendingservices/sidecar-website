// /api/data/inventory-buffer
// GET                  -> { items: [...] }  non-machine "buffer stock" (storage unit, car, etc.)
// POST { id?, name, sku, productId, quantity, bufferThreshold, reorderThreshold, unitCost, location }
//   creates a new item if id is omitted, otherwise updates that id.
// DELETE ?id=...
//
// Requires a D1 database bound as "DB". Sits behind Cloudflare Access.

function genId() {
  return crypto.randomUUID();
}
function isMissingTableError(err) {
  return /no such table/i.test(String(err && err.message || err));
}

export async function onRequestGet({ env }) {
  try {
    const { results } = await env.DB.prepare(
      `SELECT id, name, sku, product_id as productId, quantity,
              buffer_threshold as bufferThreshold, reorder_threshold as reorderThreshold,
              unit_cost as unitCost, location, updated_at as updatedAt
       FROM inventory_buffer ORDER BY name ASC`
    ).all();
    return Response.json({ items: results });
  } catch (err) {
    if (isMissingTableError(err)) {
      return Response.json({ items: [], _migrationNeeded: 'migrations/004_orders_inventory_service.sql' });
    }
    return Response.json({ error: String(err.message || err) }, { status: 500 });
  }
}

export async function onRequestPost({ request, env }) {
  const body = await request.json();
  const {
    name, sku = '', productId = '', quantity = 0,
    bufferThreshold = null, reorderThreshold = null, unitCost = null, location = '',
  } = body;
  if (!name) return Response.json({ error: 'name is required' }, { status: 400 });

  try {
    const id = body.id || genId();
    const updatedAt = new Date().toISOString();
    if (body.id) {
      const existing = await env.DB.prepare('SELECT id FROM inventory_buffer WHERE id = ?1').bind(body.id).first();
      if (existing) {
        await env.DB.prepare(
          `UPDATE inventory_buffer SET
             name=?2, sku=?3, product_id=?4, quantity=?5, buffer_threshold=?6,
             reorder_threshold=?7, unit_cost=?8, location=?9, updated_at=?10
           WHERE id=?1`
        ).bind(id, name, sku, productId, quantity, bufferThreshold, reorderThreshold, unitCost, location, updatedAt).run();
        return Response.json({ id, name, sku, productId, quantity, bufferThreshold, reorderThreshold, unitCost, location, updatedAt });
      }
    }
    await env.DB.prepare(
      `INSERT INTO inventory_buffer (id, name, sku, product_id, quantity, buffer_threshold, reorder_threshold, unit_cost, location, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`
    ).bind(id, name, sku, productId, quantity, bufferThreshold, reorderThreshold, unitCost, location, updatedAt).run();
    return Response.json({ id, name, sku, productId, quantity, bufferThreshold, reorderThreshold, unitCost, location, updatedAt });
  } catch (err) {
    if (isMissingTableError(err)) {
      return Response.json({
        error: 'The inventory_buffer table doesn\'t exist yet — run migrations/004_orders_inventory_service.sql against the D1 database, then try again.',
      }, { status: 500 });
    }
    return Response.json({ error: String(err.message || err) }, { status: 500 });
  }
}

export async function onRequestDelete({ request, env }) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return Response.json({ error: 'id query param required' }, { status: 400 });
  await env.DB.prepare('DELETE FROM inventory_buffer WHERE id = ?1').bind(id).run();
  return Response.json({ ok: true });
}
