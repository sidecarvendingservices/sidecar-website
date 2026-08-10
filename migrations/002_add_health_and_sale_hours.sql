-- Adds machine health history (online/offline + temperature snapshots) and
-- hour-of-day sales granularity, so the dashboard can show:
--   - a Machine Health tab with current status + history of offline/temp events
--   - a Sales by Hour / Sales by Day pattern chart
--
-- Run once against the "sidecar-ops" D1 database:
--   npx wrangler d1 execute sidecar-ops --remote --file=migrations/002_add_health_and_sale_hours.sql

CREATE TABLE IF NOT EXISTS machine_health (
  id TEXT PRIMARY KEY,
  machine_id TEXT NOT NULL,
  checked_at TEXT NOT NULL,        -- ISO 8601 timestamp of the poll
  is_online INTEGER NOT NULL,      -- 0 or 1
  status TEXT,                     -- HAHA device status, e.g. ACTIVE / FROZEN
  temperature REAL,                -- NULL for non-refrigerated devices
  temperature_unit TEXT,           -- CELSIUS or FAHRENHEIT
  warning_low REAL,                -- warningTemperatureStart from HAHA, if provided
  warning_high REAL                -- warningTemperatureEnd from HAHA, if provided
);
CREATE INDEX IF NOT EXISTS idx_machine_health_machine_time
  ON machine_health(machine_id, checked_at);

CREATE TABLE IF NOT EXISTS sale_hours (
  id TEXT PRIMARY KEY,
  machine_id TEXT NOT NULL,
  date TEXT NOT NULL,              -- YYYY-MM-DD, device-local
  hour INTEGER NOT NULL,           -- 0-23, device-local
  gross REAL NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'haha'
);
CREATE INDEX IF NOT EXISTS idx_sale_hours_machine_date
  ON sale_hours(machine_id, date);
