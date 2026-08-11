// /api/data/product-capacity
// GET  ?machineId=          -> { capacities: [...] }  (all machines if omitted)
// POST { machineId, productId, productName, capacity }
//   Upserts by (machineId, productId) — the target "full" stock level for
//   that slot. Optional: the Fill Machines pick list falls back to "replace
//   what sold" for any product without a capacity set.
// DELETE ?id=...
//
// Requires a D1 database bound as "DB". Sits behind Cloudflare Access.
// Added via migrations/007_products.sql — degrades gracefully if not run yet.

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
                        capacity, updated_at as updatedAt
                 FROM product_capacity WHERE 1=1`;
    const binds = [];
    if (machineId) { binds.push(machineId); query += ` AND machine_id = ?${binds.length}`; }
    const { results } = await env.DB.prepare(query).bind(...binds).all();
    return Response.json({ capacities: results });
  } catch (err) {
    if (isMissingTableError(err)) {
      return Response.json({ capacities: [], _migrationNeeded: 'migrations/007_products.sql' });
    }
    return Response.json({ error: String(err.message || err) }, { status: 500 });
  }
}

export async function onRequestPost({ request, env }) {
  const body = await request.json();
  const { machineId, productId, productName = '', capacity } = body;
  if (!machineId || !productId || capacity === undefined || capacity === null || capacity === '') {
    return Response.json({ error: 'machineId, productId, and capacity are required' }, { status: 400 });
  }
  try {
    const updatedAt = new Date().toISOString();
    const existing = await env.DB.prepare(
      'SELECT id FROM product_capacity WHERE machine_id = ?1 AND product_id = ?2'
    ).bind(machineId, productId).first();

    if (existing) {
      await env.DB.prepare(
        `UPDATE product_capacity SET product_name=?3, capacity=?4, updated_at=?5 WHERE machine_id=?1 AND product_id=?2`
      ).bind(machineId, productId, productName, capacity, updatedAt).run();
      return Response.json({ id: existing.id, machineId, productId, productName, capacity, updatedAt });
    }
    const id = genId();
    await env.DB.prepare(
      `INSERT INTO product_capacity (id, machine_id, product_id, product_name, capacity, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
    ).bind(id, machineId, productId, productName, capacity, updatedAt).run();
    return Response.json({ id, machineId, productId, productName, capacity, updatedAt });
  } catch (err) {
    if (isMissingTableError(err)) {
      return Response.json({ error: 'The product_capacity table doesn\'t exist yet — run migrations/007_products.sql, then try again.' }, { status: 500 });
    }
    return Response.json({ error: String(err.message || err) }, { status: 500 });
  }
}

export async function onRequestDelete({ request, env }) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return Response.json({ error: 'id query param required' }, { status: 400 });
  await env.DB.prepare('DELETE FROM product_capacity WHERE id = ?1').bind(id).run();
  return Response.json({ ok: true });
}
