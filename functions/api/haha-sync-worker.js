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
//   - auto-creates "Stock & Service Machines at [Property]" tasks ~3 days
//     before the soonest projected stockout across that property's
//     machines, assigned to the property's Stocker
//   - auto-creates immediate follow-up tasks when a machine goes offline or
//     out of temperature range, assigned to the property's Account Manager,
//     and auto-completes them once the machine recovers
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

  // ---- Task automation (service-by-date + offline/out-of-temp) ----
  // Runs last, off the same token/machine list above, so it never delays or
  // risks the sales/health sync itself.
  try {
    await runTaskAutomation(env, token, machines, log);
  } catch (err) {
    log(`Task automation failed: ${err.message}`);
  }
}

function isMissingTableOrColumn(err) {
  return /no such (table|column)/i.test(String(err && err.message || err));
}
function genId(prefix) {
  return prefix + '_' + crypto.randomUUID();
}
function isoToday() {
  return new Date().toISOString().slice(0, 10);
}
function addDaysIso(dateStr, days) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Reshapes HAHA's per-product inventory list into { machineHahaId -> [{productId, stock}, ...] },
// same shape functions/api/haha-market-inventory.js exposes to the dashboard — duplicated
// here rather than imported since this file is deployed as its own standalone Worker (see
// header) and can't reach into the Pages project's functions/_lib/ at deploy time.
async function fetchInventoryByMarket(env, token) {
  const all = await fetchAllPages(env, token, '/open/api/v1/inventory/products');
  const byMarket = {};
  all.forEach((p) => {
    (p.markets || []).forEach((mk) => {
      if (!byMarket[mk.marketId]) byMarket[mk.marketId] = [];
      byMarket[mk.marketId].push({ productId: p.productId, stock: mk.stock || 0 });
    });
  });
  return byMarket;
}

// Task automation, run at the end of every sync (see runSync). Two things:
//   1. "Stock & Service Machines at [Property]" — one task per property,
//      created once the soonest projected stockout across that property's
//      machines is within 3 days, assigned to the property's Stocker.
//   2. Offline / out-of-temperature follow-ups — one task per machine,
//      created immediately when it goes bad, assigned to the property's
//      Account Manager, auto-completed once the machine recovers.
// Both degrade to a no-op (logged, not thrown) if migrations 005 or 009
// haven't been run yet, so this never takes down the sales/health sync above.
async function runTaskAutomation(env, token, machines, log) {
  if (!machines.length) return;

  let properties, teamById;
  try {
    const { results: propRows } = await env.DB.prepare(
      `SELECT id, name, account_manager_id as accountManagerId, stocker_id as stockerId FROM properties`
    ).all();
    properties = propRows;
    const { results: teamRows } = await env.DB.prepare(`SELECT id, name FROM team_members`).all();
    teamById = {};
    teamRows.forEach((t) => { teamById[t.id] = t.name; });
  } catch (err) {
    if (isMissingTableOrColumn(err)) { log(`Task automation skipped (${err.message}) — run migrations/005 and migrations/009_team.sql if this persists.`); return; }
    throw err;
  }
  const propertiesById = {};
  properties.forEach((p) => { propertiesById[p.id] = p; });

  const { results: machineRows } = await env.DB.prepare(
    `SELECT id, name, haha_id as hahaId, property_id as propertyId FROM machines WHERE haha_id IS NOT NULL AND haha_id != ''`
  ).all();
  const machineById = {};
  machineRows.forEach((m) => { machineById[m.id] = m; });

  const today = isoToday();

  // ---- 1. Service-by-date tasks, aggregated per property ----
  try {
    const byMarket = await fetchInventoryByMarket(env, token);
    const windowStart = addDaysIso(today, -14);
    const { results: soldRows } = await env.DB.prepare(
      `SELECT oi.machine_id as machineId, oi.product_id as productId, SUM(oi.quantity) as qty
       FROM order_items oi JOIN orders o ON o.id = oi.order_id
       WHERE o.date >= ?1 AND o.date <= ?2 AND o.is_refund = 0
       GROUP BY oi.machine_id, oi.product_id`
    ).bind(windowStart, today).all();
    const velocityByMachineProduct = {};
    soldRows.forEach((r) => { velocityByMachineProduct[`${r.machineId}|${r.productId}`] = r.qty / 14; });

    // Soonest projected stockout per machine, then the soonest across each property's machines.
    const soonestByProperty = {};
    machineRows.forEach((m) => {
      const stockRows = byMarket[m.hahaId];
      if (!stockRows || !m.propertyId) return;
      let soonestDays = null;
      stockRows.forEach((row) => {
        const velocity = velocityByMachineProduct[`${m.id}|${row.productId}`] || 0;
        if (velocity <= 0) return; // no recent sell-through — not projectable
        const daysRemaining = row.stock <= 0 ? 0 : row.stock / velocity;
        if (soonestDays === null || daysRemaining < soonestDays) soonestDays = daysRemaining;
      });
      if (soonestDays === null) return;
      if (soonestByProperty[m.propertyId] === undefined || soonestDays < soonestByProperty[m.propertyId]) {
        soonestByProperty[m.propertyId] = soonestDays;
      }
    });

    let created = 0;
    for (const [propertyId, daysRemaining] of Object.entries(soonestByProperty)) {
      if (daysRemaining > 3) continue; // only surface once it's within ~3 days
      const property = propertiesById[propertyId];
      if (!property) continue;

      const { results: existingOpen } = await env.DB.prepare(
        `SELECT id FROM tasks WHERE category = 'auto-service' AND property_id = ?1 AND status != 'complete'`
      ).bind(propertyId).all();
      if (existingOpen.length) continue; // already have an open one — don't pile on duplicates

      const nextServiceBy = addDaysIso(today, Math.max(0, Math.round(daysRemaining)));
      const owner = (property.stockerId && teamById[property.stockerId]) || 'Unassigned';
      await env.DB.prepare(
        `INSERT INTO tasks (id, title, description, owner, due_date, priority, status, category, recurring, property_id, machine_id, contact_id, created_at, completed_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'to_do', 'auto-service', '', ?7, NULL, NULL, ?8, NULL)`
      ).bind(
        genId('task'), `Stock & Service Machines at ${property.name}`,
        'Auto-created — projected stockout on at least one product within 3 days.',
        owner, nextServiceBy, daysRemaining <= 0 ? 'critical' : 'high', propertyId, new Date().toISOString(),
      ).run();
      created += 1;
    }
    log(`Task automation: ${created} service task(s) created`);
  } catch (err) {
    if (isMissingTableOrColumn(err)) log(`Service-by-date automation skipped (${err.message})`);
    else log(`Service-by-date automation failed: ${err.message}`);
  }

  // ---- 2. Offline / out-of-temperature follow-ups, per machine ----
  try {
    let createdAlerts = 0;
    let resolvedAlerts = 0;
    for (const m of machineRows) {
      const latest = await env.DB.prepare(
        `SELECT is_online as isOnline, temperature, warning_low as warningLow, warning_high as warningHigh
         FROM machine_health WHERE machine_id = ?1 ORDER BY checked_at DESC LIMIT 1`
      ).bind(m.id).first();
      if (!latest) continue;

      const outOfTemp = latest.temperature !== null && latest.temperature !== undefined &&
        ((latest.warningLow !== null && latest.temperature < latest.warningLow) ||
         (latest.warningHigh !== null && latest.temperature > latest.warningHigh));
      const isBad = !latest.isOnline || outOfTemp;

      const { results: openAlerts } = await env.DB.prepare(
        `SELECT id FROM tasks WHERE category = 'auto-alert' AND machine_id = ?1 AND status != 'complete'`
      ).bind(m.id).all();

      if (isBad && !openAlerts.length) {
        const property = m.propertyId ? propertiesById[m.propertyId] : null;
        const owner = (property && property.accountManagerId && teamById[property.accountManagerId]) || 'Unassigned';
        const reason = !latest.isOnline ? 'offline' : 'temperature out of range';
        await env.DB.prepare(
          `INSERT INTO tasks (id, title, description, owner, due_date, priority, status, category, recurring, property_id, machine_id, contact_id, created_at, completed_at)
           VALUES (?1, ?2, ?3, ?4, ?5, 'critical', 'to_do', 'auto-alert', '', ?6, ?7, NULL, ?8, NULL)`
        ).bind(
          genId('task'), `${m.name} is ${reason}`, 'Auto-created by the HAHA sync worker — will auto-complete once the machine recovers.',
          owner, today, m.propertyId || null, m.id, new Date().toISOString(),
        ).run();
        createdAlerts += 1;
      } else if (!isBad && openAlerts.length) {
        const now = new Date().toISOString();
        for (const t of openAlerts) {
          await env.DB.prepare(`UPDATE tasks SET status = 'complete', completed_at = ?2 WHERE id = ?1`).bind(t.id, now).run();
        }
        resolvedAlerts += openAlerts.length;
      }
    }
    log(`Task automation: ${createdAlerts} alert task(s) created, ${resolvedAlerts} auto-resolved`);
  } catch (err) {
    if (isMissingTableOrColumn(err)) log(`Offline/temperature automation skipped (${err.message})`);
    else log(`Offline/temperature automation failed: ${err.message}`);
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
