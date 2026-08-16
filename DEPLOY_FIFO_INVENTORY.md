# Deploying the FIFO inventory system (migration 008)

This adds real lot-based inventory tracking on top of the existing
`product_costs` table: every purchase becomes a "lot" that lives somewhere
(backstock or a machine) and gets drawn down oldest-first as you restock
machines or QMOS product out. It also folds your current Buffer Stock
quantities into real backstock lots so nothing gets lost.

## One-time setup

Run this once against the database (same pattern as the earlier migrations):

```
cd ~/Documents/GitHub/sidecar-website/Sidecar-Website-Local/Untitled
npx wrangler d1 execute sidecar-ops --remote --file=migrations/008_fifo_inventory.sql
```

That's it — no new bindings or secrets needed, this only adds tables/columns
to the D1 database you already have connected.

## What this changes for you

- Old `product_costs` rows (purchase history you already logged) are left
  alone but start at `quantity_remaining = 0` — there's no reliable way to
  know how much of that old purchase history is still physically on hand,
  so they stay as historical records only, not live stock.
- Anything currently in **Buffer Stock** gets copied into real backstock
  lots automatically, dated today, so your current on-hand supply carries
  forward without you re-entering it.
- After this runs, I'll give you a list of starting quantities computed
  from your HAHA sales history, so you can zero out (or intentionally leave
  slightly negative, for products already sold since tracking started)
  each product before logging your real, current purchase — that's the
  "test the whole workflow with real numbers" approach you asked for.
- Backstock (and machine inventory) **can go negative** on purpose — if you
  restock or QMOS more than the system thinks you have on hand, it doesn't
  block you, it just shows the shortfall so you can see where the tracking
  and reality have drifted apart, rather than losing the transaction.
