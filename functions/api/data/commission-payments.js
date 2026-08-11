// /api/data/commission-payments
// GET ?month=            -> { payments: [...] }
// POST { groupKey, propertyId, month, amountOwed, status, paidDate, amountPaid, paymentMethod, statementSent, notes }
//   Upserts by (groupKey, month) — call this to record/update a period's
//   payable, and again with status:'paid' as the "Mark Paid" action.
//
// Requires a D1 database bound as "DB". Sits behind Cloudflare Access.

function genId(prefix) {
  return prefix + '_' + crypto.randomUUID();
}
function isMissingTableError(err) {
  return /no such table/i.test(String(err && err.message || err));
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const month = url.searchParams.get('month');
  try {
    let query = `SELECT id, group_key as groupKey, property_id as propertyId, month, amount_owed as amountOwed,
                        status, paid_date as paidDate, amount_paid as amountPaid, payment_method as paymentMethod,
                        statement_sent as statementSent, notes, updated_at as updatedAt
                 FROM commission_payments WHERE 1=1`;
    const binds = [];
    if (month) { binds.push(month); query += ` AND month = ?${binds.length}`; }
    query += ' ORDER BY month DESC';
    const { results } = await env.DB.prepare(query).bind(...binds).all();
    return Response.json({ payments: results.map(p => ({ ...p, statementSent: !!p.statementSent })) });
  } catch (err) {
    if (isMissingTableError(err)) {
      return Response.json({ payments: [], _migrationNeeded: 'migrations/006_financials.sql' });
    }
    return Response.json({ error: String(err.message || err) }, { status: 500 });
  }
}

export async function onRequestPost({ request, env }) {
  const body = await request.json();
  const {
    groupKey, propertyId = null, month, amountOwed = 0, status = 'due',
    paidDate = null, amountPaid = null, paymentMethod = null, statementSent = false, notes = '',
  } = body;
  if (!groupKey || !month) return Response.json({ error: 'groupKey and month are required' }, { status: 400 });

  try {
    const updatedAt = new Date().toISOString();
    const existing = await env.DB.prepare(
      'SELECT id FROM commission_payments WHERE group_key = ?1 AND month = ?2'
    ).bind(groupKey, month).first();

    if (existing) {
      await env.DB.prepare(
        `UPDATE commission_payments SET property_id=?3, amount_owed=?4, status=?5, paid_date=?6,
           amount_paid=?7, payment_method=?8, statement_sent=?9, notes=?10, updated_at=?11
         WHERE group_key=?1 AND month=?2`
      ).bind(groupKey, month, propertyId, amountOwed, status, paidDate, amountPaid, paymentMethod, statementSent ? 1 : 0, notes, updatedAt).run();
      return Response.json({ id: existing.id, groupKey, propertyId, month, amountOwed, status, paidDate, amountPaid, paymentMethod, statementSent, notes });
    }
    const id = genId('cp');
    await env.DB.prepare(
      `INSERT INTO commission_payments (id, group_key, property_id, month, amount_owed, status, paid_date, amount_paid, payment_method, statement_sent, notes, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`
    ).bind(id, groupKey, propertyId, month, amountOwed, status, paidDate, amountPaid, paymentMethod, statementSent ? 1 : 0, notes, updatedAt).run();
    return Response.json({ id, groupKey, propertyId, month, amountOwed, status, paidDate, amountPaid, paymentMethod, statementSent, notes });
  } catch (err) {
    if (isMissingTableError(err)) {
      return Response.json({ error: 'The commission_payments table doesn\'t exist yet — run migrations/006_financials.sql, then try again.' }, { status: 500 });
    }
    return Response.json({ error: String(err.message || err) }, { status: 500 });
  }
}
