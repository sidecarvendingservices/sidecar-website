-- v1.10.2 §11 (Property contracts) and §13 (Demo/Consultation Resources)
--
-- property_contracts: one uploaded document, scoped to a property, with
-- an explicit list of which machines it covers (contract_machines join
-- table) — "all machines at this property" is the default at upload time
-- (every current machine pre-checked), not an implicit/automatic rule, so
-- a new machine added later does NOT silently inherit coverage from an
-- existing "all machines" contract (per spec: "New machines require
-- explicit contract assignment").
--
-- property_contract_ack: the "No Contract — Acknowledged" resolution path
-- — a deliberate, tracked state (who/when acknowledged no contract exists)
-- rather than just silently not flagging it. One row per property; deleted
-- automatically the next time a real contract is uploaded for that property
-- (see property-contracts.js POST).
--
-- demo_resources: site-visit materials (virtual brochure, product guide
-- examples, etc.) — flat list, no property/machine scoping, content
-- supplied later by Brian.

CREATE TABLE IF NOT EXISTS property_contracts (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL,
  file_key TEXT NOT NULL,        -- R2 object key under document-upload.js's "contracts/" prefix
  file_name TEXT,
  notes TEXT,
  uploaded_by TEXT,               -- actor email, from the verified Access JWT
  uploaded_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_property_contracts_property ON property_contracts(property_id);

CREATE TABLE IF NOT EXISTS contract_machines (
  contract_id TEXT NOT NULL,
  machine_id TEXT NOT NULL,
  PRIMARY KEY (contract_id, machine_id)
);

CREATE TABLE IF NOT EXISTS property_contract_ack (
  property_id TEXT PRIMARY KEY,
  acknowledged_by TEXT,
  acknowledged_at TEXT NOT NULL,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS demo_resources (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  file_key TEXT NOT NULL,        -- R2 object key under document-upload.js's "demo-resources/" prefix
  file_name TEXT,
  uploaded_by TEXT,
  uploaded_at TEXT NOT NULL
);
