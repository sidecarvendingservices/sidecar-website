// /api/data/product-categories
// GET  -> { categories: { [productId]: category } }
// POST { productId, productName?, category } -> upsert one product's category tag.
// GET ?performance=1&days=30 -> { byCategory: [{category, revenue, units}], byCategoryAndPropertyType: [...] }
//   Sales-by-category breakdown, joined from order_items -> orders (date range) and
//   product_categories, plus a cut by each order's machine's property type.
//
// Requires a D1 database bound as "DB". Sits behind Cloudflare Access.
// Added via migrations/013_product_categories.sql — degrades gracefully if not run yet.

function isMissingTableOrColumn(err) {
  return /no such (table|column)/i.test(String(err && err.message || err));
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);

  if (url.searchParams.get('performance')) {
    const days = Math.min(parseInt(url.searchParams.get('days') || '30', 10) || 30, 365);
    try {
      const since = new Date();
      since.setDate(since.getDate() - days);
      const sinceStr = since.toISOString().slice(0, 10);

      const { results: rows } = await env.DB.prepare(
        `SELECT COALESCE(pc.category, 'Uncategorized') as category, p.property_type as propertyType,
                oi.quantity as quantity, oi.item_total as itemTotal, oi.price as price
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
         LEFT JOIN product_categories pc ON pc.product_id = oi.product_id
         LEFT JOIN machines m ON m.id = oi.machine_id
         LEFT JOIN properties p ON p.id = m.property_id
         WHERE o.date >= ?1 AND o.is_refund = 0`
      ).bind(sinceStr).all();

      const byCategory = {};
      const byCategoryAndType = {};
      rows.forEach((r) => {
        const revenue = r.itemTotal !== null && r.itemTotal !== undefined ? r.itemTotal : (r.price || 0) * (r.quantity || 0);
        const units = r.quantity || 0;
        if (!byCategory[r.category]) byCategory[r.category] = { category: r.category, revenue: 0, units: 0 };
        byCategory[r.category].revenue += revenue;
        byCategory[r.category].units += units;

        const propType = r.propertyType || 'Unknown';
        const key = `${r.category}|${propType}`;
        if (!byCategoryAndType[key]) byCategoryAndType[key] = { category: r.category, propertyType: propType, revenue: 0, units: 0 };
        byCategoryAndType[key].revenue += revenue;
        byCategoryAndType[key].units += units;
      });

      return Response.json({
        days,
        byCategory: Object.values(byCategory).sort((a, b) => b.revenue - a.revenue),
        byCategoryAndPropertyType: Object.values(byCategoryAndType).sort((a, b) => b.revenue - a.revenue),
      });
    } catch (err) {
      if (isMissingTableOrColumn(err)) return Response.json({ byCategory: [], byCategoryAndPropertyType: [], _migrationNeeded: 'migrations/013_product_categories.sql' });
      return Response.json({ error: String(err.message || err) }, { status: 500 });
    }
  }

  try {
    const { results } = await env.DB.prepare('SELECT product_id as productId, category FROM product_categories').all();
    const categories = {};
    results.forEach((r) => { categories[r.productId] = r.category; });
    return Response.json({ categories });
  } catch (err) {
    if (isMissingTableOrColumn(err)) return Response.json({ categories: {}, _migrationNeeded: 'migrations/013_product_categories.sql' });
    return Response.json({ error: String(err.message || err) }, { status: 500 });
  }
}

export async function onRequestPost({ request, env }) {
  const body = await request.json();
  const { productId, productName = '', category = '' } = body;
  if (!productId) return Response.json({ error: 'productId is required' }, { status: 400 });

  try {
    const now = new Date().toISOString();
    const existing = await env.DB.prepare('SELECT product_id FROM product_categories WHERE product_id = ?1').bind(productId).first();
    if (existing) {
      await env.DB.prepare('UPDATE product_categories SET category = ?2, product_name = ?3, updated_at = ?4 WHERE product_id = ?1')
        .bind(productId, category, productName, now).run();
    } else {
      await env.DB.prepare('INSERT INTO product_categories (product_id, product_name, category, updated_at) VALUES (?1, ?2, ?3, ?4)')
        .bind(productId, productName, category, now).run();
    }
    return Response.json({ productId, productName, category });
  } catch (err) {
    if (isMissingTableOrColumn(err)) {
      return Response.json({ error: 'Run migrations/013_product_categories.sql, then try again.' }, { status: 500 });
    }
    return Response.json({ error: String(err.message || err) }, { status: 500 });
  }
}
