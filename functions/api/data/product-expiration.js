// /api/data/product-expiration
// GET ?machineId=          -> { expirations: [...] }  (all machines if omitted)
// POST { machineId, productId, productName, expirationDate }
//   Upserts by (machineId, productId) — one row per product per machine,
//   representing the soonest expiration date currently in that slot.
// DELETE ?id=...
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
  try {
    let query = `SELECT id, machine_id as machineId, product_id as productId, product_name as productName,
                        expiration_date as expirationDate, updated_at as updatedAt
                 FROM product_expiration WHERE 1=1`;
    const binds = [];
    if (machineId) { binds.push(machineId); query += ` AND machine_id = ?${binds.length}`; }
    query += ' ORDER BY expiration_date ASC';
    const { results } = await env.DB.prepare(query).bind(...binds).all();
    return Response.json({ expirations: results });
  } catch (err) {
    if (isMissingTableError(err)) {
      return Response.json({ expirations: [], _migrationNeeded: 'migrations/004_orders_inventory_service.sql' });
    }
    return Response.json({ error: String(err.message || err) }, { status: 500 });
  }
}

export async function onRequestPost({ request, env }) {
  const body = await request.json();
  const { machineId, productId, productName = '', expirationDate } = body;
  if (!machineId || !productId || !expirationDate) {
    return Response.json({ error: 'machineId, productId, and expirationDate are required' }, { status: 400 });
  }
  try {
    const updatedAt = new Date().toISOString();
    const existing = await env.DB.prepare(
      'SELECT id FROM product_expiration WHERE machine_id = ?1 AND product_id = ?2'
    ).bind(machineId, productId).first();

    if (existing) {
      await env.DB.prepare(
        `UPDATE product_expiration SET product_name=?3, expiration_date=?4, updated_at=?5 WHERE machine_id=?1 AND product_id=?2`
      ).bind(machineId, productId, productName, expirationDate, updatedAt).run();
      return Response.json({ id: existing.id, machineId, productId, productName, expirationDate, updatedAt });
    }
    const id = genId();
    await env.DB.prepare(
      `INSERT INTO product_expiration (id, machine_id, product_id, product_name, expiration_date, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
    ).bind(id, machineId, productId, productName, expirationDate, updatedAt).run();
    return Response.json({ id, machineId, productId, productName, expirationDate, updatedAt });
  } catch (err) {
    if (isMissingTableError(err)) {
      return Response.json({
        error: 'The product_expiration table doesn\'t exist yet — run migrations/004_orders_inventory_service.sql against the D1 database, then try again.',
      }, { status: 500 });
    }
    return Response.json({ error: String(err.message || err) }, { status: 500 });
  }
}

export async function onRequestDelete({ request, env }) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return Response.json({ error: 'id query param required' }, { status: 400 });
  await env.DB.prepare('DELETE FROM product_expiration WHERE id = ?1').bind(id).run();
  return Response.json({ ok: true });
}
