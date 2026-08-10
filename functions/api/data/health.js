// /api/data/health
// GET ?machineId=&since=&limit=   -> { health: [...] }  full history, newest first
// GET ?latest=1                    -> { health: [...] }  one row per machine (most recent)
// POST  { readings: [{ machineId, checkedAt, isOnline, status, temperature,
//                       temperatureUnit, warningLow, warningHigh }, ...] }
//       bulk-inserts snapshot rows (one per machine per poll). Used by the
//       "Check Now" button and by the scheduled HAHA sync worker.
//
// Requires a D1 database bound as "DB". Sits behind Cloudflare Access.

function genId() {
  return crypto.randomUUID();
}

// If migration 002 hasn't been run yet, machine_health won't exist. Rather than
// 500'ing (which, via Promise.all on the dashboard, used to take the entire
// page down — machines/sales/expenses included), every query here degrades to
// an empty result with a `_migrationNeeded` hint the UI can surface quietly.
function isMissingTableError(err) {
  return /no such table/i.test(String(err && err.message || err));
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const machineId = url.searchParams.get('machineId');
  const since = url.searchParams.get('since');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '500', 10) || 500, 2000);
  const latestOnly = url.searchParams.get('latest') === '1';

  try {
    if (latestOnly) {
      const { results } = await env.DB.prepare(
        `SELECT mh.id, mh.machine_id as machineId, mh.checked_at as checkedAt,
                mh.is_online as isOnline, mh.status, mh.temperature,
                mh.temperature_unit as temperatureUnit,
                mh.warning_low as warningLow, mh.warning_high as warningHigh
         FROM machine_health mh
         JOIN (
           SELECT machine_id, MAX(checked_at) AS maxc FROM machine_health GROUP BY machine_id
         ) latest ON mh.machine_id = latest.machine_id AND mh.checked_at = latest.maxc`
      ).all();
      return Response.json({ health: results.map((r) => ({ ...r, isOnline: !!r.isOnline })) });
    }

    let query = `SELECT id, machine_id as machineId, checked_at as checkedAt,
                        is_online as isOnline, status, temperature,
                        temperature_unit as temperatureUnit,
                        warning_low as warningLow, warning_high as warningHigh
                 FROM machine_health WHERE 1=1`;
    const binds = [];
    if (machineId) { binds.push(machineId); query += ` AND machine_id = ?${binds.length}`; }
    if (since) { binds.push(since); query += ` AND checked_at >= ?${binds.length}`; }
    query += ' ORDER BY checked_at DESC';
    binds.push(limit);
    query += ` LIMIT ?${binds.length}`;

    const { results } = await env.DB.prepare(query).bind(...binds).all();
    return Response.json({ health: results.map((r) => ({ ...r, isOnline: !!r.isOnline })) });
  } catch (err) {
    if (isMissingTableError(err)) {
      return Response.json({ health: [], _migrationNeeded: 'migrations/002_add_health_and_sale_hours.sql' });
    }
    return Response.json({ error: String(err.message || err) }, { status: 500 });
  }
}

export async function onRequestPost({ request, env }) {
  const body = await request.json();
  const readings = Array.isArray(body.readings) ? body.readings : (body.machineId ? [body] : []);
  if (!readings.length) {
    return Response.json({ error: 'readings array (or a single reading) is required' }, { status: 400 });
  }

  try {
    const stmts = readings.map((r) => {
      if (!r.machineId) throw new Error('each reading needs a machineId');
      const checkedAt = r.checkedAt || new Date().toISOString();
      return env.DB.prepare(
        `INSERT INTO machine_health
          (id, machine_id, checked_at, is_online, status, temperature, temperature_unit, warning_low, warning_high)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`
      ).bind(
        genId(), r.machineId, checkedAt,
        r.isOnline ? 1 : 0,
        r.status || null,
        r.temperature === undefined || r.temperature === null ? null : Number(r.temperature),
        r.temperatureUnit || null,
        r.warningLow === undefined || r.warningLow === null ? null : Number(r.warningLow),
        r.warningHigh === undefined || r.warningHigh === null ? null : Number(r.warningHigh),
      );
    });

    await env.DB.batch(stmts);
    return Response.json({ ok: true, inserted: stmts.length });
  } catch (err) {
    if (isMissingTableError(err)) {
      return Response.json({
        ok: false,
        error: 'The machine_health table doesn\'t exist yet — run migrations/002_add_health_and_sale_hours.sql against the D1 database, then try again.',
      });
    }
    return Response.json({ ok: false, error: String(err.message || err) }, { status: 500 });
  }
}
