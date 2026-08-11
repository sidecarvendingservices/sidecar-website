// /api/data/contacts
// GET ?propertyId=   -> { contacts: [...] }
// POST { id?, propertyId, name, title, email, phone, preferredContact, isPrimary, notes }
// DELETE ?id=...
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
  const propertyId = url.searchParams.get('propertyId');
  try {
    let query = `SELECT id, property_id as propertyId, name, title, email, phone,
                        preferred_contact as preferredContact, is_primary as isPrimary, notes, created_at as createdAt
                 FROM contacts WHERE 1=1`;
    const binds = [];
    if (propertyId) { binds.push(propertyId); query += ` AND property_id = ?${binds.length}`; }
    query += ' ORDER BY is_primary DESC, name ASC';
    const { results } = await env.DB.prepare(query).bind(...binds).all();
    return Response.json({ contacts: results.map(c => ({ ...c, isPrimary: !!c.isPrimary })) });
  } catch (err) {
    if (isMissingTableError(err)) {
      return Response.json({ contacts: [], _migrationNeeded: 'migrations/005_properties_contacts_activity_tasks.sql' });
    }
    return Response.json({ error: String(err.message || err) }, { status: 500 });
  }
}

export async function onRequestPost({ request, env }) {
  const body = await request.json();
  const { propertyId, name, title = '', email = '', phone = '', preferredContact = '', isPrimary = false, notes = '' } = body;
  if (!propertyId || !name) return Response.json({ error: 'propertyId and name are required' }, { status: 400 });

  try {
    // Only one primary contact per property — demote any existing one if this is being set primary.
    if (isPrimary) {
      await env.DB.prepare('UPDATE contacts SET is_primary = 0 WHERE property_id = ?1').bind(propertyId).run();
    }
    if (body.id) {
      const existing = await env.DB.prepare('SELECT id FROM contacts WHERE id = ?1').bind(body.id).first();
      if (existing) {
        await env.DB.prepare(
          `UPDATE contacts SET name=?2, title=?3, email=?4, phone=?5, preferred_contact=?6, is_primary=?7, notes=?8 WHERE id=?1`
        ).bind(body.id, name, title, email, phone, preferredContact, isPrimary ? 1 : 0, notes).run();
        return Response.json({ id: body.id, propertyId, name, title, email, phone, preferredContact, isPrimary, notes });
      }
    }
    const id = body.id || genId('contact');
    const createdAt = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO contacts (id, property_id, name, title, email, phone, preferred_contact, is_primary, notes, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`
    ).bind(id, propertyId, name, title, email, phone, preferredContact, isPrimary ? 1 : 0, notes, createdAt).run();
    return Response.json({ id, propertyId, name, title, email, phone, preferredContact, isPrimary, notes, createdAt });
  } catch (err) {
    if (isMissingTableError(err)) {
      return Response.json({ error: 'The contacts table doesn\'t exist yet — run migrations/005_properties_contacts_activity_tasks.sql, then try again.' }, { status: 500 });
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
