// POST /api/data/merge-machines
// body: { keepId, removeId }
//
// Folds a duplicate machine into another: reassigns its sales, expenses, and
// (if those tables exist) hourly sales + health history to keepId, then
// deletes the removeId row. Used by the "Merge" action the dashboard shows
// when it spots two machine rows sharing a HAHA Market ID or name+host.
//
// Requires a D1 database bound as "DB". Sits behind Cloudflare Access.

function isMissingTableError(err) {
  return /no such table/i.test(String(err && err.message || err));
}

export async function onRequestPost({ request, env }) {
  const body = await request.json();
  const { keepId, removeId } = body;
  if (!keepId || !removeId) {
    return Response.json({ error: 'keepId and removeId are required' }, { status: 400 });
  }
  if (keepId === removeId) {
    return Response.json({ error: 'keepId and removeId must be different machines' }, { status: 400 });
  }

  const keep = await env.DB.prepare('SELECT id FROM machines WHERE id = ?1').bind(keepId).first();
  const remove = await env.DB.prepare('SELECT id FROM machines WHERE id = ?1').bind(removeId).first();
  if (!keep || !remove) {
    return Response.json({ error: 'One of these machines no longer exists — reload and try again.' }, { status: 404 });
  }

  await env.DB.prepare('UPDATE sales SET machine_id = ?1 WHERE machine_id = ?2').bind(keepId, removeId).run();
  await env.DB.prepare('UPDATE expenses SET machine_id = ?1 WHERE machine_id = ?2').bind(keepId, removeId).run();

  // These tables may not exist yet (migration 002) — that's fine, just skip them.
  try {
    await env.DB.prepare('UPDATE sale_hours SET machine_id = ?1 WHERE machine_id = ?2').bind(keepId, removeId).run();
  } catch (err) { if (!isMissingTableError(err)) throw err; }
  try {
    await env.DB.prepare('UPDATE machine_health SET machine_id = ?1 WHERE machine_id = ?2').bind(keepId, removeId).run();
  } catch (err) { if (!isMissingTableError(err)) throw err; }

  await env.DB.prepare('DELETE FROM machines WHERE id = ?1').bind(removeId).run();

  return Response.json({ ok: true, keepId, removeId });
}
