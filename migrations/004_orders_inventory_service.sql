-- Adds order-level drill-down, non-machine buffer inventory, machine service
-- history, and per-machine-product expiration tracking.
--
-- Run once against the "sidecar-ops" D1 database:
--   npx wrangler d1 execute sidecar-ops --remote --file=migrations/004_orders_inventory_service.sql

-- Raw order records (one row per HAHA order, or per manually-logged order).
-- The existing `sales` table stays as-is (daily totals, feeds the Overview/
-- Commission math) — this is additive, purely for drill-down + pay-period
-- order counts, so it does not touch anything already working.
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,           -- HAHA saleId/orderNo (naturally unique) or a generated id
  machine_id TEXT NOT NULL,
  order_dtm TEXT NOT NULL,       -- ISO 8601 timestamp of the sale
  date TEXT NOT NULL,            -- YYYY-MM-DD, derived from order_dtm, device-local
  gross REAL NOT NULL DEFAULT 0,
  net REAL NOT NULL DEFAULT 0,
  status TEXT,
  is_refund INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'haha'
);
CREATE INDEX IF NOT EXISTS idx_orders_machine_date ON orders(machine_id, date);
CREATE INDEX IF NOT EXISTS idx_orders_date ON orders(date);

CREATE TABLE IF NOT EXISTS order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  machine_id TEXT NOT NULL,
  product_id TEXT,
  product_name TEXT,
  quantity INTEGER NOT NULL DEFAULT 0,
  price REAL,
  item_total REAL
);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_machine_product ON order_items(machine_id, product_id);

-- Non-machine "buffer stock" — supplies sitting in a storage unit/car/garage,
-- not loaded into a machine yet.
CREATE TABLE IF NOT EXISTS inventory_buffer (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sku TEXT,
  product_id TEXT,                -- optional link to a HAHA productId, for cost/price/image
  quantity INTEGER NOT NULL DEFAULT 0,
  buffer_threshold INTEGER,       -- target par level
  reorder_threshold INTEGER,      -- reorder trigger point
  unit_cost REAL,
  location TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS service_log (
  id TEXT PRIMARY KEY,
  machine_id TEXT NOT NULL,
  serviced_at TEXT NOT NULL,      -- YYYY-MM-DD
  serviced_by TEXT,
  notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_service_log_machine ON service_log(machine_id, serviced_at);

-- One row per (machine, product): the soonest expiration date currently
-- sitting in that machine for that product. Manually entered/updated on
-- restock — HAHA's API does not expose expiration data.
CREATE TABLE IF NOT EXISTS product_expiration (
  id TEXT PRIMARY KEY,
  machine_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_name TEXT,
  expiration_date TEXT NOT NULL,  -- YYYY-MM-DD
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_expiration_machine_product
  ON product_expiration(machine_id, product_id);
