-- v1.10.1 F17: Activity & Audit History
--
-- A real system audit log, distinct from `activity_log` (migration 005),
-- which is the CRM call/note/follow-up log tied to properties — this table
-- is "who changed what in the system," not "who talked to which property."
--
-- Records who changed pricing, planograms, inventory, expenses,
-- permissions, contracts, device state, or resolved an alert, with
-- before/after values and outcome. v1.10.2's gated features (remote device
-- control, pricing edits, planogram edits) are expected to write here too
-- once they exist — this migration just lays the table down.
--
-- Written to via functions/_lib/audit.js's logAudit() helper. Read via
-- GET /api/data/audit-log (functions/api/data/audit-log.js).

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  actor_email TEXT,               -- from the verified Access JWT; NULL if unauthenticated context (shouldn't happen given Access gating, but never block a write on this)
  actor_name TEXT,                -- resolved team_members.name at write time, so a later name change doesn't rewrite history
  action TEXT NOT NULL,           -- 'role_change' | 'property_reassign' | 'machine_reassign' | ... (extend as new instrumented paths are added)
  entity_type TEXT NOT NULL,      -- 'team_member' | 'property' | 'machine' | ...
  entity_id TEXT NOT NULL,
  entity_label TEXT,              -- human-readable name at write time (e.g. the team member's name), so the log reads clearly even if the entity is later renamed or deleted
  before_json TEXT,               -- JSON snapshot of the changed field(s) before
  after_json TEXT,                -- JSON snapshot of the changed field(s) after
  outcome TEXT NOT NULL DEFAULT 'success',  -- 'success' | 'failure'
  occurred_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_occurred ON audit_log(occurred_at);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id);
