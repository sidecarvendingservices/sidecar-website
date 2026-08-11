// /api/data/properties
// GET                -> { properties: [...] }
// GET ?id=...         -> { property: {...}, contacts: [...], machines: [...] }  (detail view)
// POST { id?, name, propertyType, address, website, notes, placementType, status, relationshipStarted, assignedOperator }
// DELETE ?id=...      -> only allowed if no machines are linked (returns 409 otherwise)
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
  const id = url.searchParams.get('id');
  try {
    if (id) {
      const property = await env.DB.prepare(
        `SELECT id, name, property_type as propertyType, address, website, notes,
                placement_type as placementType, status, relationship_started as relationshipStarted,
                assigned_operator as assignedOperator, created_at as createdAt
         FROM properties WHERE id = ?1`
      ).bind(id).first();
      if (!property) return Response.json({ error: 'Property not found' }, { status: 404 });

      const { results: contacts } = await env.DB.prepare(
        `SELECT id, property_id as propertyId, name, title, email, phone,
                preferred_contact as preferredContact, is_primary as isPrimary, notes, created_at as createdAt
         FROM contacts WHERE property_id = ?1 ORDER BY is_primary DESC, name ASC`
      ).bind(id).all();

      const { results: machineRows } = await env.DB.prepare(
        `SELECT id, name, host, address, plan, install, haha_id as hahaId, status,
                contact_name as contactName, contact_phone as contactPhone, contact_email as contactEmail
         FROM machines WHERE property_id = ?1 ORDER BY name ASC`
      ).bind(id).all();

      return Response.json({
        property,
        contacts: contacts.map(c => ({ ...c, isPrimary: !!c.isPrimary })),
        machines: machineRows,
      });
    }

    const { results } = await env.DB.prepare(
      `SELECT id, name, property_type as propertyType, address, website, notes,
              placement_type as placementType, status, relationship_started as relationshipStarted,
              assigned_operator as assignedOperator, created_at as createdAt
       FROM properties ORDER BY name ASC`
    ).all();
    return Response.json({ properties: results });
  } catch (err) {
    if (isMissingTableError(err)) {
      return Response.json({ properties: [], _migrationNeeded: 'migrations/005_properties_contacts_activity_tasks.sql' });
    }
    return Response.json({ error: String(err.message || err) }, { status: 500 });
  }
}

export async function onRequestPost({ request, env }) {
  const body = await request.json();
  const {
    name, propertyType = '', address = '', website = '', notes = '',
    placementType = 'none', status = 'active', relationshipStarted = '', assignedOperator = '',
  } = body;
  if (!name) return Response.json({ error: 'name is required' }, { status: 400 });

  try {
    if (body.id) {
      const existing = await env.DB.prepare('SELECT id FROM properties WHERE id = ?1').bind(body.id).first();
      if (existing) {
        await env.DB.prepare(
          `UPDATE properties SET name=?2, property_type=?3, address=?4, website=?5, notes=?6,
             placement_type=?7, status=?8, relationship_started=?9, assigned_operator=?10 WHERE id=?1`
        ).bind(body.id, name, propertyType, address, website, notes, placementType, status, relationshipStarted, assignedOperator).run();
        return Response.json({ id: body.id, name, propertyType, address, website, notes, placementType, status, relationshipStarted, assignedOperator });
      }
    }
    const id = body.id || genId('prop');
    const createdAt = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO properties (id, name, property_type, address, website, notes, placement_type, status, relationship_started, assigned_operator, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`
    ).bind(id, name, propertyType, address, website, notes, placementType, status, relationshipStarted, assignedOperator, createdAt).run();
    return Response.json({ id, name, propertyType, address, website, notes, placementType, status, relationshipStarted, assignedOperator, createdAt });
  } catch (err) {
    if (isMissingTableError(err)) {
      return Response.json({ error: 'The properties table doesn\'t exist yet — run migrations/005_properties_contacts_activity_tasks.sql, then try again.' }, { status: 500 });
    }
    return Response.json({ error: String(err.message || err) }, { status: 500 });
  }
}

export async function onRequestDelete({ request, env }) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return Response.json({ error: 'id query param required' }, { status: 400 });
  const linked = await env.DB.prepare('SELECT COUNT(*) as n FROM machines WHERE property_id = ?1').bind(id).first();
  if (linked && linked.n > 0) {
    return Response.json({ error: `${linked.n} machine(s) are still linked to this property — reassign them first.` }, { status: 409 });
  }
  await env.DB.prepare('DELETE FROM contacts WHERE property_id = ?1').bind(id).run();
  await env.DB.prepare('DELETE FROM activity_log WHERE property_id = ?1').bind(id).run();
  await env.DB.prepare('DELETE FROM properties WHERE id = ?1').bind(id).run();
  return Response.json({ ok: true });
}
