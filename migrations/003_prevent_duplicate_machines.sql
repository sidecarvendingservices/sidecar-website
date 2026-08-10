-- Defense-in-depth against duplicate machine rows (the app-level checks in
-- functions/api/data/machines.js already block this, but a DB-level
-- constraint means it can never happen even if that code changes later).
--
-- A partial unique index — only enforced for non-blank HAHA Market IDs, since
-- machines without one (not yet linked to HAHA) are allowed to share a blank value.
--
-- Run once against the "sidecar-ops" D1 database:
--   npx wrangler d1 execute sidecar-ops --remote --file=migrations/003_prevent_duplicate_machines.sql
--
-- If this fails with a UNIQUE constraint error, it means duplicate machines
-- already exist in the table — use the dashboard's "Possible Duplicate
-- Machines" panel on the Machines tab to merge them first, then re-run this.

CREATE UNIQUE INDEX IF NOT EXISTS idx_machines_haha_id_unique
  ON machines(haha_id)
  WHERE haha_id IS NOT NULL AND haha_id != '';
