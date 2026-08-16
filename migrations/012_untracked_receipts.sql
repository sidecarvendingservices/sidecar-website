-- Phase 6: untracked receipts.
--
-- A quick "Upload Receipt" from anywhere shouldn't require knowing the
-- expense details on the spot — this table holds the raw upload (already in
-- R2 via receipt-upload.js) until someone logs the actual expense against
-- it. Each new row auto-creates a task (category 'auto-receipt') assigned
-- to whoever uploaded it, which auto-completes the moment the receipt is
-- matched to a real expense — same auto-resolve pattern as the HAHA sync
-- worker's offline/temperature alerts.

CREATE TABLE IF NOT EXISTS untracked_receipts (
  id TEXT PRIMARY KEY,
  r2_key TEXT NOT NULL,
  filename TEXT,
  content_type TEXT,
  uploaded_by TEXT,
  uploaded_by_email TEXT,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'unmatched',
  matched_expense_id TEXT,
  task_id TEXT,
  created_at TEXT NOT NULL,
  matched_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_untracked_receipts_status ON untracked_receipts(status);
