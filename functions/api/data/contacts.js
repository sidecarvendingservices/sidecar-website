// /api/data/contacts
// GET                   -> { contacts: [...] }  every contact, property-linked or standalone
// GET ?propertyId=      -> { contacts: [...] }  scoped to one property
// POST { id?, propertyId?, company?, name, title, email, phone, preferredContact, isPrimary, notes }
//   propertyId is optional — omit it for a standalone prospect not yet tied to a property
//   (use `company` to note where they work instead).
// DELETE ?id=...
//
// Requires a D1 database bound as "DB". Sits behind Cloudflare Access.
// property_id became nullable and `company` was added via migrations/010_contacts_calls.sql.

function genId(prefix) {
  return prefix + '_' + crypto.randomUUID();
}
function isMissingTableOrColumn(err) {
  return /no such (table|column)/i.test(String(err && err.message || err));
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const propertyId = url.searchParams.get('propertyId');
  try {
    let query = `SELECT c.id, c.property_id as propertyId, c.company, c.name, c.title, c.email, c.phone,
                        c.preferred_contact as preferredContact, c.is_primary as isPrimary, c.notes,
                        c.created_at as createdAt, p.name as propertyName
                 FROM contacts c LEFT JOIN properties p ON p.id = c.property_id WHERE 1=1`;
    const binds = [];
    if (propertyId) { binds.push(propertyId); query += ` AND c.property_id = ?${binds.length}`; }
    query += ' ORDER BY c.is_primary DESC, c.name ASC';
    const { results } = await env.DB.prepare(query).bind(...binds).all();
    return Response.json({ contacts: results.map(c => ({ ...c, isPrimary: !!c.isPrimary })) });
  } catch (err) {
    if (isMissingTableOrColumn(err)) {
      return Response.json({ contacts: [], _migrationNeeded: 'migrations/005_properties_contacts_activity_tasks.sql' });
    }
    return Response.json({ error: String(err.message || err) }, { status: 500 });
  }
}

export async function onRequestPost({ request, env }) {
  const body = await request.json();
  const { propertyId = null, company = '', name, title = '', email = '', phone = '', preferredContact = '', isPrimary = false, notes = '' } = body;
  if (!name) return Response.json({ error: 'name is required' }, { status: 400 });

  try {
    if (isPrimary && propertyId) {
      await env.DB.prepare('UPDATE contacts SET is_primary = 0 WHERE property_id = ?1').bind(propertyId).run();
    }
    if (body.id) {
      const existing = await env.DB.prepare('SELECT id FROM contacts WHERE id = ?1').bind(body.id).first();
      if (existing) {
        await env.DB.prepare(
          `UPDATE contacts SET property_id=?2, company=?3, name=?4, title=?5, email=?6, phone=?7, preferred_contact=?8, is_primary=?9, notes=?10 WHERE id=?1`
        ).bind(body.id, propertyId, company, name, title, email, phone, preferredContact, isPrimary ? 1 : 0, notes).run();
        return Response.json({ id: body.id, propertyId, company, name, title, email, phone, preferredContact, isPrimary, notes });
      }
    }
    const id = body.id || genId('contact');
    const createdAt = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO contacts (id, property_id, company, name, title, email, phone, preferred_contact, is_primary, notes, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`
    ).bind(id, propertyId, company, name, title, email, phone, preferredContact, isPrimary ? 1 : 0, notes, createdAt).run();
    return Response.json({ id, propertyId, company, name, title, email, phone, preferredContact, isPrimary, notes, createdAt });
  } catch (err) {
    if (isMissingTableOrColumn(err)) {
      return Response.json({ error: 'Run migrations/005_properties_contacts_activity_tasks.sql and migrations/010_contacts_calls.sql, then try again.' }, { status: 500 });
    }
    return Response.json({ error: String(err.message || err) }, { status: 500 });
  }
}

export async function onRequestDelete({ request, env }) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return Response.json({ error: 'id query param required' }, { status: 400 });
  await env.DB.prepare('DELETE FROM contacts WHERE id = ?1').bind(id).run();
  return Response.json({ ok: true });
}
