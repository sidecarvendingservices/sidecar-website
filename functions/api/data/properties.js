// /api/data/properties
// GET                -> { properties: [...] }  (each row includes accountManagerName/stockerName,
//                         resolved via a LEFT JOIN against team_members, for display without a
//                         second round trip)
// GET ?id=...         -> { property: {...}, contacts: [...], machines: [...] }  (detail view)
// POST { id?, name, propertyType, address, website, notes, placementType, status,
//         relationshipStarted, assignedOperator, accountManagerId, stockerId }
// DELETE ?id=...      -> only allowed if no machines are linked (returns 409 otherwise)
//
// accountManagerId/stockerId reference team_members.id (see migrations/009_team.sql) and are
// the source of truth machines inherit from — machines don't store their own copy, they just
// display whatever their property currently has set.
//
// Requires a D1 database bound as "DB". Sits behind Cloudflare Access.

function genId(prefix) {
  return prefix + '_' + crypto.randomUUID();
}
function isMissingTableOrColumn(err) {
  return /no such (table|column)/i.test(String(err && err.message || err));
}

const PROPERTY_SELECT = `
  SELECT p.id, p.name, p.property_type as propertyType, p.address, p.website, p.notes,
         p.placement_type as placementType, p.status, p.relationship_started as relationshipStarted,
         p.assigned_operator as assignedOperator, p.account_manager_id as accountManagerId,
         p.stocker_id as stockerId, am.name as accountManagerName, st.name as stockerName,
         p.created_at as createdAt
  FROM properties p
  LEFT JOIN team_members am ON am.id = p.account_manager_id
  LEFT JOIN team_members st ON st.id = p.stocker_id
`;

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  try {
    if (id) {
      const property = await env.DB.prepare(`${PROPERTY_SELECT} WHERE p.id = ?1`).bind(id).first();
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
        // Machines inherit the property's Account Manager / Stocker rather than storing their
        // own — stamp it on here so any view built off this list doesn't need a second lookup.
        machines: machineRows.map(m => ({ ...m, accountManagerName: property.accountManagerName, stockerName: property.stockerName })),
      });
    }

    const { results } = await env.DB.prepare(`${PROPERTY_SELECT} ORDER BY p.name ASC`).all();
    return Response.json({ properties: results });
  } catch (err) {
    if (isMissingTableOrColumn(err)) {
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
    accountManagerId = null, stockerId = null,
  } = body;
  if (!name) return Response.json({ error: 'name is required' }, { status: 400 });

  try {
    if (body.id) {
      const existing = await env.DB.prepare('SELECT id FROM properties WHERE id = ?1').bind(body.id).first();
      if (existing) {
        await env.DB.prepare(
          `UPDATE properties SET name=?2, property_type=?3, address=?4, website=?5, notes=?6,
             placement_type=?7, status=?8, relationship_started=?9, assigned_operator=?10,
             account_manager_id=?11, stocker_id=?12 WHERE id=?1`
        ).bind(body.id, name, propertyType, address, website, notes, placementType, status, relationshipStarted, assignedOperator,
          accountManagerId || null, stockerId || null).run();
        return Response.json({ id: body.id, name, propertyType, address, website, notes, placementType, status, relationshipStarted, assignedOperator, accountManagerId, stockerId });
      }
    }
    const id = body.id || genId('prop');
    const createdAt = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO properties (id, name, property_type, address, website, notes, placement_type, status, relationship_started, assigned_operator, account_manager_id, stocker_id, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)`
    ).bind(id, name, propertyType, address, website, notes, placementType, status, relationshipStarted, assignedOperator,
      accountManagerId || null, stockerId || null, createdAt).run();
    return Response.json({ id, name, propertyType, address, website, notes, placementType, status, relationshipStarted, assignedOperator, accountManagerId, stockerId, createdAt });
  } catch (err) {
    if (isMissingTableOrColumn(err)) {
      return Response.json({ error: 'Run migrations/005_properties_contacts_activity_tasks.sql and migrations/009_team.sql against the D1 database, then try again.' }, { status: 500 });
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
