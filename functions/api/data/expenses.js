// /api/data/expenses
// GET  ?start=&end=          -> { expenses: [...] }  (filters optional)
// POST -> body: { date, category, amount, machineId?, note?, vendor?, paidBy?, paymentMethod?,
//                  reimbursable?, reimbursed?, recurring?, expenseType?, receiptRef? }
// PUT  ?id=... -> body: same fields as POST — v1.10.2 §2, full edit (was
//                  previously add/delete only, no edit).
// DELETE ?id=...
//
// Requires a D1 database bound as "DB". Sits behind Cloudflare Access.
// vendor/paidBy/paymentMethod/reimbursable/reimbursed/recurring/expenseType/receiptRef
// were added via migrations/006_financials.sql — this file works before or
// after that migration has run (falls back to the narrower column set).

function genId() {
  return crypto.randomUUID();
}
function isMissingColumnOrTable(err) {
  return /no such (table|column)/i.test(String(err && err.message || err));
}

const WIDE_SELECT = `SELECT id, date, category, amount, machine_id as machineId, note,
         vendor, paid_by as paidBy, payment_method as paymentMethod,
         reimbursable, reimbursed, recurring, expense_type as expenseType, receipt_ref as receiptRef
       FROM expenses WHERE 1=1`;
const NARROW_SELECT = `SELECT id, date, category, amount, machine_id as machineId, note FROM expenses WHERE 1=1`;

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const start = url.searchParams.get('start');
  const end = url.searchParams.get('end');

  const runQuery = async (base) => {
    let query = base;
    const binds = [];
    if (start) { binds.push(start); query += ` AND date >= ?${binds.length}`; }
    if (end) { binds.push(end); query += ` AND date <= ?${binds.length}`; }
    query += ' ORDER BY date DESC';
    return env.DB.prepare(query).bind(...binds).all();
  };

  try {
    const { results } = await runQuery(WIDE_SELECT);
    return Response.json({ expenses: results.map(e => ({ ...e, reimbursable: !!e.reimbursable, reimbursed: !!e.reimbursed })) });
  } catch (err) {
    if (!isMissingColumnOrTable(err)) return Response.json({ error: String(err.message || err) }, { status: 500 });
    const { results } = await runQuery(NARROW_SELECT);
    return Response.json({
      expenses: results.map(e => ({ ...e, vendor: '', paidBy: '', paymentMethod: '', reimbursable: false, reimbursed: false, recurring: '', expenseType: 'operating', receiptRef: '' })),
      _migrationNeeded: 'migrations/006_financials.sql',
    });
  }
}

export async function onRequestPost({ request, env }) {
  const body = await request.json();
  const {
    date, category, amount, machineId = null, note = '',
    vendor = '', paidBy = '', paymentMethod = '', reimbursable = false, reimbursed = false,
    recurring = '', expenseType = 'operating', receiptRef = '',
  } = body;
  if (!date || !category || amount === undefined) {
    return Response.json({ error: 'date, category, and amount are required' }, { status: 400 });
  }
  const id = genId();
  const responseBody = { date, category, amount, machineId, note, vendor, paidBy, paymentMethod, reimbursable, reimbursed, recurring, expenseType, receiptRef };

  try {
    await env.DB.prepare(
      `INSERT INTO expenses (id, date, category, amount, machine_id, note, vendor, paid_by, payment_method, reimbursable, reimbursed, recurring, expense_type, receipt_ref)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`
    ).bind(id, date, category, amount, machineId, note, vendor, paidBy, paymentMethod, reimbursable ? 1 : 0, reimbursed ? 1 : 0, recurring, expenseType, receiptRef).run();
  } catch (err) {
    if (!isMissingColumnOrTable(err)) return Response.json({ error: String(err.message || err) }, { status: 500 });
    await env.DB.prepare(
      `INSERT INTO expenses (id, date, category, amount, machine_id, note) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
    ).bind(id, date, category, amount, machineId, note).run();
  }

  return Response.json({ id, ...responseBody });
}

export async function onRequestPut({ request, env }) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return Response.json({ error: 'id query param required' }, { status: 400 });

  const body = await request.json();
  const {
    date, category, amount, machineId = null, note = '',
    vendor = '', paidBy = '', paymentMethod = '', reimbursable = false, reimbursed = false,
    recurring = '', expenseType = 'operating', receiptRef = '',
  } = body;
  if (!date || !category || amount === undefined) {
    return Response.json({ error: 'date, category, and amount are required' }, { status: 400 });
  }

  const existing = await env.DB.prepare('SELECT id FROM expenses WHERE id = ?1').bind(id).first();
  if (!existing) return Response.json({ error: 'Expense not found' }, { status: 404 });

  try {
    await env.DB.prepare(
      `UPDATE expenses SET date=?2, category=?3, amount=?4, machine_id=?5, note=?6,
         vendor=?7, paid_by=?8, payment_method=?9, reimbursable=?10, reimbursed=?11,
         recurring=?12, expense_type=?13, receipt_ref=?14 WHERE id=?1`
    ).bind(id, date, category, amount, machineId, note, vendor, paidBy, paymentMethod,
      reimbursable ? 1 : 0, reimbursed ? 1 : 0, recurring, expenseType, receiptRef).run();
  } catch (err) {
    if (!isMissingColumnOrTable(err)) return Response.json({ error: String(err.message || err) }, { status: 500 });
    await env.DB.prepare(
      `UPDATE expenses SET date=?2, category=?3, amount=?4, machine_id=?5, note=?6 WHERE id=?1`
    ).bind(id, date, category, amount, machineId, note).run();
  }
  return Response.json({ id, date, category, amount, machineId, note, vendor, paidBy, paymentMethod, reimbursable, reimbursed, recurring, expenseType, receiptRef });
}

export async function onRequestDelete({ request, env }) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return Response.json({ error: 'id query param required' }, { status: 400 });
  await env.DB.prepare('DELETE FROM expenses WHERE id = ?1').bind(id).run();
  return Response.json({ ok: true });
}
