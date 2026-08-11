// POST /api/data/migrate-properties
//
// One-time (safely re-runnable) setup step that backfills the new Property/
// Contact layer from existing machine data, without losing or blindly
// merging anything:
//   - Only machines with property_id IS NULL are touched — already-assigned
//     machines are left alone, so this is safe to run more than once.
//   - Machines are grouped by their trimmed/lowercased `host` field. Each
//     group becomes one Property (name = host). Machines with a blank host
//     each become their own Property (name = machine name) — never guessed
//     into a shared bucket.
//   - Within a host group, every DISTINCT non-blank (contactName, contactPhone,
//     contactEmail) combination becomes its own Contact — differing contacts
//     are never merged into one. The first one seen is marked primary.
//   - The machine's own contact_name/phone/email fields are left in place
//     (harmless duplication) for backward compatibility, but the Property/
//     Contact records become the source of truth going forward.
//
// Returns a summary so the dashboard can show what was created, for review.
//
// Requires a D1 database bound as "DB". Sits behind Cloudflare Access.

function genId(prefix) {
  return prefix + '_' + crypto.randomUUID();
}

export async function onRequestPost({ env }) {
  const { results: unassigned } = await env.DB.prepare(
    `SELECT id, name, host, contact_name as contactName, contact_phone as contactPhone, contact_email as contactEmail
     FROM machines WHERE property_id IS NULL`
  ).all();

  if (!unassigned.length) {
    return Response.json({ ok: true, propertiesCreated: 0, contactsCreated: 0, machinesLinked: 0, message: 'Every machine already belongs to a property.' });
  }

  // Group by trimmed/lowercased host; blank-host machines get their own group key.
  const groups = {};
  unassigned.forEach((m) => {
    const host = (m.host || '').trim();
    const key = host ? 'host:' + host.toLowerCase() : 'machine:' + m.id;
    if (!groups[key]) groups[key] = { displayName: host || m.name, machines: [] };
    groups[key].machines.push(m);
  });

  const now = new Date().toISOString();
  const propertyStmts = [];
  const contactStmts = [];
  const machineUpdateStmts = [];
  const summary = [];

  for (const key of Object.keys(groups)) {
    const group = groups[key];
    const propertyId = genId('prop');
    propertyStmts.push(
      env.DB.prepare(
        `INSERT INTO properties (id, name, status, created_at) VALUES (?1, ?2, 'active', ?3)`
      ).bind(propertyId, group.displayName, now)
    );

    // Distinct non-blank contact combos within this group.
    const seenCombos = new Map();
    group.machines.forEach((m) => {
      const name = (m.contactName || '').trim();
      const phone = (m.contactPhone || '').trim();
      const email = (m.contactEmail || '').trim();
      if (!name && !phone && !email) return;
      const comboKey = `${name.toLowerCase()}|${phone}|${email.toLowerCase()}`;
      if (!seenCombos.has(comboKey)) seenCombos.set(comboKey, { name: name || 'Property Contact', phone, email });
    });
    let first = true;
    for (const combo of seenCombos.values()) {
      contactStmts.push(
        env.DB.prepare(
          `INSERT INTO contacts (id, property_id, name, phone, email, is_primary, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
        ).bind(genId('contact'), propertyId, combo.name, combo.phone, combo.email, first ? 1 : 0, now)
      );
      first = false;
    }

    group.machines.forEach((m) => {
      machineUpdateStmts.push(env.DB.prepare('UPDATE machines SET property_id = ?1 WHERE id = ?2').bind(propertyId, m.id));
    });

    summary.push({ property: group.displayName, machines: group.machines.map((m) => m.name), contactsCreated: seenCombos.size });
  }

  if (propertyStmts.length) await env.DB.batch(propertyStmts);
  if (contactStmts.length) await env.DB.batch(contactStmts);
  if (machineUpdateStmts.length) await env.DB.batch(machineUpdateStmts);

  return Response.json({
    ok: true,
    propertiesCreated: propertyStmts.length,
    contactsCreated: contactStmts.length,
    machinesLinked: machineUpdateStmts.length,
    summary,
  });
}
