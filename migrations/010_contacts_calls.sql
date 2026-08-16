-- Phase 5: Contacts overhaul + Tasks & Calls unification.
--
-- contacts.property_id and activity_log.property_id become nullable so a
-- contact/call can stand on its own as a prospect not yet tied to a
-- property — SQLite has no ALTER COLUMN, so both tables are rebuilt
-- (new table -> copy rows -> drop old -> rename), same technique as any
-- NOT NULL relaxation in SQLite. Existing rows are preserved untouched.
--
-- contacts.company is new — free-text "where do they work" for a standalone
-- prospect that has no property yet to describe that.

CREATE TABLE contacts_new (
  id TEXT PRIMARY KEY,
  property_id TEXT,
  company TEXT,
  name TEXT NOT NULL,
  title TEXT,
  email TEXT,
  phone TEXT,
  preferred_contact TEXT,
  is_primary INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL
);
INSERT INTO contacts_new (id, property_id, company, name, title, email, phone, preferred_contact, is_primary, notes, created_at)
  SELECT id, property_id, NULL, name, title, email, phone, preferred_contact, is_primary, notes, created_at FROM contacts;
DROP TABLE contacts;
ALTER TABLE contacts_new RENAME TO contacts;
CREATE INDEX IF NOT EXISTS idx_contacts_property ON contacts(property_id);

CREATE TABLE activity_log_new (
  id TEXT PRIMARY KEY,
  property_id TEXT,
  machine_id TEXT,
  contact_id TEXT,
  type TEXT NOT NULL,
  direction TEXT,
  outcome TEXT,
  summary TEXT NOT NULL,
  notes TEXT,
  follow_up_date TEXT,
  owner TEXT,
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
INSERT INTO activity_log_new (id, property_id, machine_id, contact_id, type, direction, outcome, summary, notes, follow_up_date, owner, occurred_at, created_at)
  SELECT id, property_id, machine_id, contact_id, type, direction, outcome, summary, notes, follow_up_date, owner, occurred_at, created_at FROM activity_log;
DROP TABLE activity_log;
ALTER TABLE activity_log_new RENAME TO activity_log;
CREATE INDEX IF NOT EXISTS idx_activity_property_time ON activity_log(property_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_activity_contact_time ON activity_log(contact_id, occurred_at);
