# Deploying Phase 4: Task automation

## What's new
The HAHA sync worker (the thing that already refreshes sales/health every 30 minutes) now also:

1. **Auto-creates a "Stock & Service Machines at [Property]" task** once any machine at that property is projected to run out of a product within ~3 days (based on 14-day sell-through vs. current HAHA-reported stock). One task per property, assigned to that property's **Stocker**. It won't create a duplicate while one is already open for that property.
2. **Auto-creates an alert task** the moment a machine goes offline or its temperature drifts outside the warning range — "[Machine] is offline" / "[Machine] is temperature out of range" — assigned to that property's **Account Manager**, priority Critical. It **auto-completes** that same task the next time the worker runs and finds the machine healthy again.

Auto-generated tasks show a small "auto" tag next to the title on the Tasks tab so they're easy to tell apart from ones you added by hand.

## Important: this needs a separate deploy, not just a git push
`haha-sync-worker.js` is deployed as its own standalone Cloudflare Worker (same one you already set up for the 30-minute sync) — pushing to GitHub updates the *website*, not this worker. After you pull these changes, redeploy the worker the same way you did the first time:

```
npx wrangler deploy --config wrangler.haha-sync-worker.toml
```

No new secrets or bindings needed — it reuses the same D1 binding and HAHA credentials already configured.

## Depends on Team + Properties being set up
Both pieces of automation look up each machine's property, and that property's Account Manager / Stocker, to decide who to assign the task to. If a property has no Stocker set, service tasks land on "Unassigned"; same for Account Manager on alert tasks. Worth double-checking your properties have both set on the Team Assignment card (Properties tab → click a property) before relying on this.

## What it does NOT do (yet)
- Doesn't factor in expiration dates or per-product Capacity settings the way the dashboard's own Restock Queue does — this is a simpler, worker-side estimate (14-day velocity vs. current stock only). The Restock Queue on the Machine Inventory tab is still the more precise view when you're actually loading a route.
- Doesn't notify anyone (no email/SMS) — it just creates the task, which shows up on Today and Tasks like anything else.
