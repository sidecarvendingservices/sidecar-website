-- Phase 6: property color coding.
--
-- Each property gets a persistent color, assigned automatically (golden-angle
-- hue spacing so colors stay visually distinct even as more properties are
-- added) the first time it's read after this migration — see the backfill
-- logic in functions/api/data/properties.js onRequestGet. Machines and
-- contacts don't get their own color column; they inherit their property's
-- color at render time (same pattern as accountManagerName/stockerName).

ALTER TABLE properties ADD COLUMN color TEXT;
