// Sidecar Ops — Scheduled HAHA Sync
//
// This is a STANDALONE Worker, deployed separately from the sidecarservices.com
// Pages project (Pages Functions can't run on a schedule — only real Workers can).
// It re-runs the same "Sync from HAHA" logic the dashboard's button does, on a
// timer, for every machine that has a HAHA Market ID set.
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
    sales.forEach((s) => {
      if (s.isRefund) return;
      const day = (s.saleDtm || '').slice(0, 10);
      if (!day) return;
      if (!byDay[day]) byDay[day] = { gross: 0, cogs: 0 };
      byDay[day].gross += parseFloat(s.saleTotal || '0');
      (s.saleItems || []).forEach((item) => {
        const unitCost = costById[item.productId] || 0;
        byDay[day].cogs += unitCost * (item.quantity || 0);
      });
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
    log(`  ${m.hahaId}: ${stmts.length} day(s) synced`);
  }

  log(`Sync complete: ${machines.length} machine(s), ${totalDays} day-entries, window ${startStr} to ${endStr}`);
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
