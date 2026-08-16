# Deploying the HAHA auto-sync worker (fixes: sync worker not running, Sales Momentum "no prior period data")

## Why this was broken

`functions/api/haha-sync-worker.js` is written as a standalone Cloudflare
Worker (not a Pages Function — Pages Functions can't run on a schedule).
There was no `wrangler.toml`/cron config committed anywhere for it, so it's
never actually had an automated schedule attached — it (probably) either
was never deployed, or was deployed once by hand with no cron trigger. That
means sales only ever got recorded when someone opened the dashboard and
clicked "Sync Now." Any week nobody clicked that button shows up as missing
data, which is exactly what causes Sales Momentum to say "no prior period
data" — there are no rows for last week to compare against.

`wrangler.haha-sync-worker.toml` (new, in repo root) fixes the *automated
part*. You'll need to run these commands once from your machine — I don't
have Cloudflare credentials in this sandbox, so I can't deploy it myself.

## One-time setup

1. Install/confirm wrangler and log in:
   ```
   npx wrangler login
   ```
   This opens a browser to authorize the CLI against your Cloudflare account.

2. Get your D1 database ID:
   ```
   npx wrangler d1 list
   ```
   Find the database this dashboard uses (likely named `sidecar-ops` — matches
   the D1 binding name `DB` used everywhere in `functions/api/data/*.js`).
   Copy its Database ID.

3. Open `wrangler.haha-sync-worker.toml` and replace
   `REPLACE_WITH_YOUR_D1_DATABASE_ID` with that ID.

4. Deploy the worker:
   ```
   npx wrangler deploy --config wrangler.haha-sync-worker.toml
   ```

5. Set the two secrets (same values as used by the main Pages project —
   check Cloudflare dashboard → Workers & Pages → sidecar-website →
   Settings → Environment variables if you need to look them up):
   ```
   npx wrangler secret put HAHA_APP_KEY --config wrangler.haha-sync-worker.toml
   npx wrangler secret put HAHA_APP_SECRET --config wrangler.haha-sync-worker.toml
   ```
   Each command will prompt you to paste the value.

6. Confirm it works by hitting the worker's URL directly in a browser (shown
   in the deploy output, something like
   `https://sidecar-haha-sync.<your-subdomain>.workers.dev`). It runs the
   same sync logic as the schedule and returns `OK` plus a per-machine log,
   or `FAILED: <error>` if something's misconfigured.

That's it — from here on, Cloudflare runs it automatically at :00 and :30
past every hour (edit the `crons` line in the toml and re-run step 4 to
change the cadence).

## Backfilling the gap

The worker only re-syncs the last `SYNC_LOOKBACK_DAYS` (3, per the toml) on
every run — it won't retroactively fill in older missing weeks on its own.
Once the worker is deployed, go to the dashboard's Sales tab → "Sync from
HAHA" card, and manually run "Sync Now" once with a start date covering
however far back you want backfilled (e.g. the last 60 days) and today as
the end date. That's a one-time catch-up; after that, the worker keeps it
current automatically and Sales Momentum will have real prior-period data
to compare against.
