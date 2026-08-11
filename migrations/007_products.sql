-- Product cost-lot ledger (so cost changes over time are tracked instead of
-- overwritten — one row per purchase, not one row per product) and an
-- optional per-machine "full capacity" per product, used by the Products
-- tab and the Fill Machines pick list.
--
-- Run once against the "sidecar-ops" D1 database:
--   npx wrangler d1 execute sidecar-ops --remote --file=migrations/007_products.sql

CREATE TABLE IF NOT EXISTS product_costs (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  product_name TEXT,
  unit_cost REAL NOT NULL,
  quantity INTEGER NOT NULL,
  purchased_date TEXT NOT NULL,
  vendor TEXT,
  notes TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_product_costs_product_date ON product_costs(product_id, purchased_date);

-- Blank/unset = the Fill Machines pick list falls back to "replace what
-- sold" only, without a capacity target.
CREATE TABLE IF NOT EXISTS product_capacity (
  id TEXT PRIMARY KEY,
  machine_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  capacity INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_capacity_machine_product ON product_capacity(machine_id, product_id);
