-- Phase 6: product category tags, for tracking which categories perform
-- best over time (and eventually vs. property type). HAHA's product
-- catalog isn't ours to write back to, so categories live in their own
-- small local table keyed by HAHA's product_id instead.

CREATE TABLE IF NOT EXISTS product_categories (
  product_id TEXT PRIMARY KEY,
  product_name TEXT,
  category TEXT,
  updated_at TEXT NOT NULL
);
