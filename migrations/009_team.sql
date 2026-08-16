-- Phase 3: Team + Cloudflare Access identity.
--
-- team_members: employee/contractor directory. `email` is matched against
-- Cloudflare Access's Cf-Access-Authenticated-User-Email header at login
-- time (see functions/api/whoami.js) so the dashboard knows who's looking
-- at it without any custom auth of its own.
--
-- properties.account_manager_id / stocker_id: who owns a property day to
-- day. Machines don't get their own copy of these — they inherit whichever
-- property they're linked to, so reassigning a property's team cascades to
-- every machine there automatically instead of needing a per-machine edit.

CREATE TABLE IF NOT EXISTS team_members (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'Stocker',
  phone TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  notes TEXT DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_team_members_email ON team_members(email);

ALTER TABLE properties ADD COLUMN account_manager_id TEXT;
ALTER TABLE properties ADD COLUMN stocker_id TEXT;
