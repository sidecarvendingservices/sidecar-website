// Sidecar Ops — Scheduled HAHA Sync
//
// This is a STANDALONE Worker, deployed separately from the sidecarservices.com
// Pages project (Pages Functions can't run on a schedule — only real Workers can).
// It re-runs the same "Sync from HAHA" logic the dashboard's button does, on a
// timer, for every machine that has a HAHA Market ID set. It also:
//   - buckets each day's sales by hour into sale_hours, for the Sales by
//     Hour / Sales by Day pattern chart
//   - polls each machine's online status + temperature into machine_health,
//     for the Machine Health tab's current-status grid and history log
//
// Required bindings/variables (set these when creating the Worker):
//   DB               - D1 database binding, same "sidecar-ops" database, variable name DB
//   HAHA_APP_KEY     - Secret, same value as used in the Pages project
//   HAHA_APP_SECRET  - Secret, same value as used in the Pages project
// Optional:
//   HAHA_API_BASE    - defaults to production below
//   SYNC_LOOKBACK_DAYS - defaults to 2 (how many days back to re-sync each run,
//                        safe to overlap since sync is idempotent per day/machine)

const DEFAULT_BASE = 'https://thor-openapi.hahavending.com';

async function getHahaToken(env) {
  const base = env.HAHA_API_BASE || DEFAULT_BASE;
  const res = await fetch(`${base}/open/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ appkey: env.HAHA_APP_KEY, appsecret: env.HAHA_APP_SECRET }),
  });
  const data = await res.json();
  if (!res.ok || data.code !== 0 || !data.data || !data.data.token) {
    throw new Error('HAHA auth failed: ' + JSON.stringify(data));
  }
  return data.data.token;
}

async function hahaGet(env, token, path, params = {}) {
  const base = env.HAHA_API_BASE || DEFAULT_BASE;
  const url = new URL(base + path);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  });
  const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json();
  if (!res.ok || data.code !== 0) throw new Error('HAHA API error: ' + JSON.stringify(data));
  return data.data;
}

async function fetchAllPages(env, token, path, extraParams = {}) {
  let page = 1;
  const page_size = 100;
  let all = [];
  let total = Infinity;
  while (all.length < total && page <= 50) {
    const data = await hahaGet(env, token, path, { ...extraParams, page, page_size });
    all = all.concat(data.list || []);
    total = data.total ?? all.length;
    if (!data.list || data.list.length < page_size) break;
    page += 1;
  }
  return all;
}

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

async function runSync(env, log) {
  const lookbackDays = parseInt(env.SYNC_LOOKBACK_DAYS || '2', 10);
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - lookbackDays);
  const startStr = isoDate(start);
  const endStr = isoDate(end);

  const token = await getHahaToken(env);

  // Build product cost lookup once for this run.
  const products = await fetchAllPages(env, token, '/open/api/v1/products');
  const costById = {};
  products.forEach((p) => { costById[p.productId] = parseFloat(p.cost || '0'); });

  const { results: machines } = await env.DB.prepare(
    `SELECT id, haha_id as hahaId FROM machines WHERE haha_id IS NOT NULL AND haha_id != ''`
  ).all();

  let totalDays = 0;
  for (const m of machines) {
    const sales = await fetchAllPages(env, token, '/open/api/v1/sales', {
      sticker_num: m.hahaId,
      start_time: startStr,
      end_time: endStr,
      status: 'PAID',
      sort: 'pay_time_asc',
    });

    const byDay = {};
    const byHour = {}; // key: `${date}|${hour}` -> gross
    sales.forEach((s) => {
      if (s.isRefund) return;
      const dtm = s.saleDtm || '';
      const day = dtm.slice(0, 10);
      if (!day) return;
      if (!byDay[day]) byDay[day] = { gross: 0, cogs: 0 };
      const total = parseFloat(s.saleTotal || '0');
      byDay[day].gross += total;
      (s.saleItems || []).forEach((item) => {
        const unitCost = costById[item.productId] || 0;
        byDay[day].cogs += unitCost * (item.quantity || 0);
      });

      const hour = parseInt(dtm.slice(11, 13), 10);
      if (!isNaN(hour)) {
        const hkey = `${day}|${hour}`;
        byHour[hkey] = (byHour[hkey] || 0) + total;
      }
    });

    await env.DB.prepare(
      `DELETE FROM sales WHERE machine_id = ?1 AND source = 'haha' AND date >= ?2 AND date <= ?3`
    ).bind(m.id, startStr, endStr).run();

    const stmts = Object.entries(byDay).map(([date, v]) =>
      env.DB.prepare(
        `INSERT INTO sales (id, machine_id, date, gross, cogs, fees, source) VALUES (?1, ?2, ?3, ?4, ?5, 0, 'haha')`
      ).bind(crypto.randomUUID(), m.id, date, v.gross, v.cogs)
    );
    if (stmts.length) await env.DB.batch(stmts);
    totalDays += stmts.length;

    // sale_hours / machine_health are newer, optional tables (migration 002).
    // If that migration hasn't been run yet on this D1 database, these calls
    // throw "no such table" — that must NOT take down the core sales sync
    // above, which has run successfully since before these tables existed.
    try {
      await env.DB.prepare(
        `DELETE FROM sale_hours WHERE machine_id = ?1 AND source = 'haha' AND date >= ?2 AND date <= ?3`
      ).bind(m.id, startStr, endStr).run();
      const hourStmts = Object.entries(byHour).map(([key, gross]) => {
        const [date, hourStr] = key.split('|');
        return env.DB.prepare(
          `INSERT INTO sale_hours (id, machine_id, date, hour, gross, source) VALUES (?1, ?2, ?3, ?4, ?5, 'haha')`
        ).bind(crypto.randomUUID(), m.id, date, parseInt(hourStr, 10), gross);
      });
      if (hourStmts.length) await env.DB.batch(hourStmts);
      log(`  ${m.hahaId}: ${stmts.length} day(s), ${hourStmts.length} hour-bucket(s) synced`);
    } catch (err) {
      log(`  ${m.hahaId}: ${stmts.length} day(s) synced. Hourly bucketing skipped (${err.message}) — run migrations/002_add_health_and_sale_hours.sql if this persists.`);
    }

    // orders / order_items (migration 004) — raw per-order records for the
    // drill-down modal + pay-period order counts. Same "must not break the
    // core sales sync" guard as sale_hours above.
    try {
      const { results: existingOrders } = await env.DB.prepare(
        `SELECT id FROM orders WHERE machine_id = ?1 AND source = 'haha' AND date >= ?2 AND date <= ?3`
      ).bind(m.id, startStr, endStr).all();
      if (existingOrders.length) {
        const existIds = existingOrders.map((r) => r.id);
        const ph = existIds.map((_, i) => `?${i + 1}`).join(',');
        await env.DB.prepare(`DELETE FROM order_items WHERE order_id IN (${ph})`).bind(...existIds).run();
      }
      await env.DB.prepare(
        `DELETE FROM orders WHERE machine_id = ?1 AND source = 'haha' AND date >= ?2 AND date <= ?3`
      ).bind(m.id, startStr, endStr).run();

      const orderStmts = [];
      const itemStmts = [];
      sales.forEach((s) => {
        const orderId = s.saleId;
        if (!orderId) return;
        orderStmts.push(
          env.DB.prepare(
            `INSERT INTO orders (id, machine_id, order_dtm, date, gross, net, status, is_refund, source)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'haha')`
          ).bind(
            orderId, m.id, s.saleDtm || '', (s.saleDtm || '').slice(0, 10),
            parseFloat(s.saleGrossTotal || s.saleTotal || '0'),
            parseFloat(s.saleTotal || '0'),
            s.status || null, s.isRefund ? 1 : 0,
          )
        );
        (s.saleItems || []).forEach((it) => {
          itemStmts.push(
            env.DB.prepare(
              `INSERT INTO order_items (id, order_id, machine_id, product_id, product_name, quantity, price, item_total)
               VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`
            ).bind(
              crypto.randomUUID(), orderId, m.id, it.productId || null, it.productName || null,
              it.quantity || 0, it.price ? parseFloat(it.price) : null,
              it.itemFinalPrice ? parseFloat(it.itemFinalPrice) : (it.itemSubTotal ? parseFloat(it.itemSubTotal) : null),
            )
          );
        });
      });
      if (orderStmts.length) await env.DB.batch(orderStmts);
      if (itemStmts.length) await env.DB.batch(itemStmts);
      log(`  ${m.hahaId}: ${orderStmts.length} order(s) synced for drill-down`);
    } catch (err) {
      log(`  ${m.hahaId}: order drill-down sync skipped (${err.message}) — run migrations/004_orders_inventory_service.sql if this persists.`);
    }
  }

  log(`Sync complete: ${machines.length} machine(s), ${totalDays} day-entries, window ${startStr} to ${endStr}`);

  // ---- Machine health poll (online status + temperature) ----
  // Also wrapped so a missing table degrades this feature only, not the sales sync above.
  if (machines.length) {
    try {
      const marketList = await fetchAllPages(env, token, '/open/api/v1/markets', {});
      const byMarketId = {};
      marketList.forEach((mk) => { byMarketId[mk.marketId] = mk; });

      const checkedAt = new Date().toISOString();
      const healthStmts = machines
        .map((m) => {
          const mk = byMarketId[m.hahaId];
          if (!mk) return null;
          const temperature = mk.temperature !== undefined && mk.temperature !== null && mk.temperature !== ''
            ? parseFloat(mk.temperature) : null;
          return env.DB.prepare(
            `INSERT INTO machine_health
              (id, machine_id, checked_at, is_online, status, temperature, temperature_unit, warning_low, warning_high)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`
          ).bind(
            crypto.randomUUID(), m.id, checkedAt,
            mk.isOnline ? 1 : 0,
            mk.status || null,
            temperature,
            mk.temperatureUnit || null,
            mk.warningTemperatureStart ?? null,
            mk.warningTemperatureEnd ?? null,
          );
        })
        .filter(Boolean);
      if (healthStmts.length) await env.DB.batch(healthStmts);
      log(`Health poll: ${healthStmts.length} machine(s) checked at ${checkedAt}`);

      // Keep the health log from growing unbounded — prune anything older than 120 days.
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 120);
      await env.DB.prepare(`DELETE FROM machine_health WHERE checked_at < ?1`).bind(cutoff.toISOString()).run();
    } catch (err) {
      log(`Health poll skipped (${err.message}) — run migrations/002_add_health_and_sale_hours.sql if this persists.`);
    }
  }
}

export default {
  async scheduled(controller, env, ctx) {
    const lines = [];
    const log = (msg) => lines.push(msg);
    try {
      await runSync(env, log);
      console.log(lines.join('\n'));
    } catch (err) {
      console.error('Scheduled HAHA sync failed:', err.message, lines.join('\n'));
      throw err; // lets Cloudflare record this run as failed
    }
  },

  // Manual trigger for testing — visiting the Worker's URL runs the same sync
  // on demand, so you can confirm it works without waiting for the schedule.
  async fetch(request, env, ctx) {
    const lines = [];
    const log = (msg) => lines.push(msg);
    try {
      await runSync(env, log);
      return new Response('OK\n' + lines.join('\n'), { status: 200 });
    } catch (err) {
      return new Response('FAILED: ' + err.message + '\n' + lines.join('\n'), { status: 500 });
    }
  },
};
