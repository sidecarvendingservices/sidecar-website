-- Adds the Property/Account layer above Machines, shared Contacts, a
-- Property Activity Timeline, and a Tasks system — the Priority 1/2
-- foundation for turning the dashboard into an operating system rather than
-- a reporting tool.
--
-- This migration only creates new, empty tables and a new nullable column
-- on `machines`. It does NOT touch existing machine/sales/expense data, and
-- does NOT auto-assign machines to properties — that happens via the
-- one-time "Set Up Properties" action in the dashboard (POST
-- /api/data/migrate-properties), which can apply real duplicate-vs-distinct
-- contact detection in JS rather than fragile migration SQL.
--
-- Run once against the "sidecar-ops" D1 database:
--   npx wrangler d1 execute sidecar-ops --remote --file=migrations/005_properties_contacts_activity_tasks.sql

CREATE TABLE IF NOT EXISTS properties (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  property_type TEXT,             -- e.g. Apartment Community, Auto Shop, Gym, Salon
  address TEXT,
  website TEXT,
  notes TEXT,
  placement_type TEXT,            -- mirrors machines.plan for now: 'none' | 'tiered'
  status TEXT NOT NULL DEFAULT 'active',   -- active | prospect | inactive
  relationship_started TEXT,      -- YYYY-MM-DD
  assigned_operator TEXT,         -- 'Brian' | 'Vala' | ''
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL,
  name TEXT NOT NULL,
  title TEXT,                     -- e.g. Property Manager, Regional Manager
  email TEXT,
  phone TEXT,
  preferred_contact TEXT,         -- 'email' | 'phone' | 'text'
  is_primary INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_contacts_property ON contacts(property_id);

-- Shared timeline at the PROPERTY level — a call/email/text/note logged
-- against any machine at a property shows up here for every owner/operator,
-- so nobody double-calls or repeats a conversation.
CREATE TABLE IF NOT EXISTS activity_log (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL,
  machine_id TEXT,                -- optional — entry can still relate to one machine
  contact_id TEXT,                -- optional
  type TEXT NOT NULL,             -- call | email | text | meeting | note | follow_up | system
  direction TEXT,                 -- inbound | outbound (calls mainly)
  outcome TEXT,                   -- Connected | Left voicemail | Follow-up needed | ...
  summary TEXT NOT NULL,
  notes TEXT,
  follow_up_date TEXT,            -- YYYY-MM-DD, optional
  owner TEXT,                     -- 'Brian' | 'Vala' | ''
  occurred_at TEXT NOT NULL,      -- ISO 8601 timestamp
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activity_property_time ON activity_log(property_id, occurred_at);

-- Every machine belongs to exactly one property (nullable until the
-- one-time setup step runs, so this migration can't break existing rows).
ALTER TABLE machines ADD COLUMN property_id TEXT;
ALTER TABLE machines ADD COLUMN status TEXT NOT NULL DEFAULT 'active'; -- active | retired
ALTER TABLE machines ADD COLUMN retired_at TEXT;
ALTER TABLE machines ADD COLUMN retired_reason TEXT;

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  owner TEXT,                     -- 'Brian' | 'Vala' | 'Unassigned'
  due_date TEXT,                  -- YYYY-MM-DD
  priority TEXT NOT NULL DEFAULT 'normal',  -- critical | high | normal | low
  status TEXT NOT NULL DEFAULT 'to_do',     -- to_do | in_progress | waiting | complete
  category TEXT,
  recurring TEXT,                 -- '' | 'weekly' | 'monthly'
  property_id TEXT,
  machine_id TEXT,
  contact_id TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_tasks_status_due ON tasks(status, due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_property ON tasks(property_id);
CREATE INDEX IF NOT EXISTS idx_tasks_machine ON tasks(machine_id);
