-- FIFO inventory: turns product_costs from a historical cost log into a
-- real lot-based inventory ledger (each purchase is a "lot" that lives
-- somewhere — backstock or a specific machine — and gets drawn down oldest
-- first), plus a QMOS/restock/sale movement audit trail.
--
-- Run once against the "sidecar-ops" D1 database:
--   npx wrangler d1 execute sidecar-ops --remote --file=migrations/008_fifo_inventory.sql

-- Existing product_costs rows (pre-migration purchase history) are left with
-- quantity_remaining = 0 — we don't know how much of those old purchases
-- was actually still on hand vs. already sold/used, so they stay as
-- historical cost records only. Real starting stock gets seeded fresh as
-- new lots (see the one-time inventory_buffer migration below, and the
-- "starting inventory" numbers provided separately).
ALTER TABLE product_costs ADD COLUMN quantity_remaining INTEGER NOT NULL DEFAULT 0;
ALTER TABLE product_costs ADD COLUMN location TEXT NOT NULL DEFAULT 'main'; -- 'main' (backstock) or a machine id
ALTER TABLE product_costs ADD COLUMN source_lot_id TEXT;      -- if this lot was split off another lot when restocked to a machine
ALTER TABLE product_costs ADD COLUMN package_price REAL;      -- optional: entered instead of unit_cost directly
ALTER TABLE product_costs ADD COLUMN package_qty INTEGER;     -- units per package, used with package_price to derive unit_cost
ALTER TABLE product_costs ADD COLUMN batch_label TEXT;        -- e.g. "Costco inventory purchase" — groups a multi-product purchase
ALTER TABLE product_costs ADD COLUMN expense_id TEXT;         -- linked expenses.id, so the purchase also shows on the Expense Log

CREATE INDEX IF NOT EXISTS idx_product_costs_location_product ON product_costs(location, product_id);
CREATE INDEX IF NOT EXISTS idx_product_costs_remaining ON product_costs(product_id, location, purchased_date);

-- Every quantity movement: a purchase entering backstock is NOT logged here
-- (that's just the product_costs row itself) — this table is for what
-- happens to it AFTERWARD: restocking a machine (draws from backstock,
-- creates a new machine-located lot), a sale (draws from a machine's lot),
-- or a QMOS write-off (draws from backstock or a machine's lot). A single
-- restock/sale/QMOS event can draw from multiple lots (oldest first), so it
-- may produce more than one row sharing the same ref_id.
CREATE TABLE IF NOT EXISTS inventory_moves (
  id TEXT PRIMARY KEY,
  lot_id TEXT NOT NULL,           -- the product_costs row this quantity was drawn from
  type TEXT NOT NULL,             -- 'restock' | 'sale' | 'qmos'
  from_location TEXT,             -- 'main' or a machine id
  to_location TEXT,               -- machine id (restock only), else NULL
  machine_id TEXT,                -- the machine this move is associated with (restock destination, or sale/qmos source)
  product_id TEXT,
  product_name TEXT,
  quantity INTEGER NOT NULL,      -- always positive; direction is implied by type/from/to
  unit_cost REAL NOT NULL,        -- snapshot from the lot at the time of the move
  reason TEXT,                    -- qmos only: 'quality' | 'sample' | 'expired'
  ref_id TEXT,                    -- groups multi-lot draws from the same event (restock batch id, order id, qmos event id)
  expense_id TEXT,                -- qmos only: linked expenses.id for the write-off cost
  date TEXT NOT NULL,             -- YYYY-MM-DD
  notes TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_inventory_moves_lot ON inventory_moves(lot_id);
CREATE INDEX IF NOT EXISTS idx_inventory_moves_machine_product ON inventory_moves(machine_id, product_id, date);
CREATE INDEX IF NOT EXISTS idx_inventory_moves_type_date ON inventory_moves(type, date);

-- One-time: fold whatever's currently sitting in inventory_buffer into real
-- backstock lots, so nothing is lost when the old flat-quantity buffer
-- system is retired in favor of lot tracking. Safe to re-run (only inserts
-- for buffer rows with quantity > 0); does not delete inventory_buffer or
-- its rows, in case anything still reads from it.
INSERT INTO product_costs (id, product_id, product_name, unit_cost, quantity, quantity_remaining, location, purchased_date, vendor, notes, created_at)
SELECT
  lower(hex(randomblob(16))),
  product_id,
  name,
  COALESCE(unit_cost, 0),
  quantity,
  quantity,
  'main',
  date('now'),
  NULL,
  'Migrated from inventory_buffer (' || COALESCE(location, 'no location noted') || ')',
  datetime('now')
FROM inventory_buffer
WHERE quantity > 0;
