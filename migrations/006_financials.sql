-- Financial management upgrades: who paid for an expense (multiple
-- owner/operators), reimbursement tracking, expense-vs-capital
-- classification, and a payable commission-payment record per property/month.
--
-- Run once against the "sidecar-ops" D1 database:
--   npx wrangler d1 execute sidecar-ops --remote --file=migrations/006_financials.sql

ALTER TABLE expenses ADD COLUMN vendor TEXT;
ALTER TABLE expenses ADD COLUMN paid_by TEXT;           -- e.g. 'Brian personally', 'Vala personally', 'Sidecar card'
ALTER TABLE expenses ADD COLUMN payment_method TEXT;
ALTER TABLE expenses ADD COLUMN reimbursable INTEGER NOT NULL DEFAULT 0;
ALTER TABLE expenses ADD COLUMN reimbursed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE expenses ADD COLUMN recurring TEXT;          -- '' | 'monthly' | 'annual'
ALTER TABLE expenses ADD COLUMN expense_type TEXT NOT NULL DEFAULT 'operating'; -- 'operating' | 'capital'
ALTER TABLE expenses ADD COLUMN receipt_ref TEXT;

-- One row per (property, month) commission payable — separate from the
-- computed commissionForMonth() figure so a paid amount/date can be recorded
-- even if the computed owed amount is later recalculated (price change,
-- correction, etc.).
CREATE TABLE IF NOT EXISTS commission_payments (
  id TEXT PRIMARY KEY,
  group_key TEXT NOT NULL,        -- matches groupKeyForMachine() in the dashboard, e.g. 'prop:<id>'
  property_id TEXT,
  month TEXT NOT NULL,            -- YYYY-MM
  amount_owed REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'due',   -- not_due | due | paid | past_due
  paid_date TEXT,
  amount_paid REAL,
  payment_method TEXT,
  statement_sent INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_commission_payments_group_month ON commission_payments(group_key, month);
