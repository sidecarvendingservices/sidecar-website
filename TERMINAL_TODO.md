# Phase 6 — What's Left For You (terminal commands + integration setup)

Everything below is stuff only you can do — database migrations need your D1
CLI access, and the two Google integrations need API credentials tied to your
Google account. Everything else in Phase 6 is already built, wired in, and
copied into your folder (version 1.9). This is the one file to work from.

## 1. Run three new D1 migrations

Same pattern as every migration so far — from the project root, against your
production D1 database (replace `sidecar-ops` if your DB binding name
differs):

```
npx wrangler d1 execute sidecar-ops --remote --file=migrations/011_property_colors.sql
npx wrangler d1 execute sidecar-ops --remote --file=migrations/012_untracked_receipts.sql
npx wrangler d1 execute sidecar-ops --remote --file=migrations/013_product_categories.sql
```

What each one does:
- **011** — adds a `color` column to `properties`. Nothing to fill in by
  hand; the dashboard auto-assigns each property a distinct color the first
  time it loads after this runs.
- **012** — creates the `untracked_receipts` table (Quick Add → Upload
  Receipt lands here until you match it to a real expense).
- **013** — creates the `product_categories` table (the new Category column
  on the Products tab, and the Category Performance card).

Until you run these, the affected features degrade gracefully (no colors,
receipts upload fails, categories/performance show empty) — nothing else on
the dashboard breaks in the meantime.

## 2. Google Ads integration (Marketing → Google Ads)

Read-only — pulls campaign performance + spend, doesn't write anything back
to your account. Needs 5 Cloudflare secrets:

```
npx wrangler pages secret put GOOGLE_ADS_CLIENT_ID
npx wrangler pages secret put GOOGLE_ADS_CLIENT_SECRET
npx wrangler pages secret put GOOGLE_ADS_REFRESH_TOKEN
npx wrangler pages secret put GOOGLE_ADS_DEVELOPER_TOKEN
npx wrangler pages secret put GOOGLE_ADS_CUSTOMER_ID
```

Where each value comes from:
1. **Client ID / Client Secret** — Google Cloud Console → APIs & Services →
   Credentials → Create an OAuth 2.0 Client ID (type: Web application). Add
   `https://developers.google.com/oauthplayground` as an authorized redirect
   URI (only needed once, to generate the refresh token below).
2. **Developer Token** — Google Ads account → Tools & Settings → API Center.
   If you don't have API access approved yet on your Ads account, apply
   there first — this can take a day or two to get approved, so it's worth
   kicking off early.
3. **Customer ID** — the 10-digit number in the top-right of Google Ads
   (format like `123-456-7890`, enter it without dashes).
4. **Refresh Token** — one-time step:
   - Go to https://developers.google.com/oauthplayground
   - Gear icon (top right) → check "Use your own OAuth credentials" → paste
     your Client ID/Secret from step 1.
   - In the scope box on the left, enter `https://www.googleapis.com/auth/adwords`,
     click Authorize, sign in with the Google account tied to your Ads
     account, allow access.
   - Click "Exchange authorization code for tokens" — copy the **Refresh
     token** shown. That's the value for `GOOGLE_ADS_REFRESH_TOKEN`.

Once all 5 secrets are set, the Marketing → Google Ads pill connects
automatically on next load — no redeploy needed for secrets, Cloudflare
picks them up immediately.

## 3. Google Analytics (GA4) integration (Marketing → Website Traffic)

Same OAuth pattern, read-only, 4 secrets:

```
npx wrangler pages secret put GA4_CLIENT_ID
npx wrangler pages secret put GA4_CLIENT_SECRET
npx wrangler pages secret put GA4_REFRESH_TOKEN
npx wrangler pages secret put GA4_PROPERTY_ID
```

- **Client ID / Client Secret** — you can reuse the same OAuth client from
  step 2 (same Google Cloud project), or create a separate one — either
  works.
- **Property ID** — Google Analytics → Admin → Property Settings → the
  numeric Property ID (not the Measurement ID that starts with "G-").
- **Refresh Token** — same OAuth Playground steps as above, but use scope
  `https://www.googleapis.com/auth/analytics.readonly` instead.

## 4. Zoho / Chase GL integration — not started yet, by design

This one's bigger (writes financial entries, not just reads) so I only built
a placeholder pill + a scoping doc rather than guessing at your setup. See
**ZOHO_INTEGRATION_SCOPE.md** in the root of the folder — it has the specific
questions I need answered (which Zoho product, whether Chase already has a
native bank feed inside Zoho Books, and the expense-category → GL-account
mapping) before I can build this for real. Nothing else depends on it.

## 5. Everything else in this batch — already done, nothing for you to do

- Property color coding (cascades to machines/contacts/tasks automatically
  once migration 011 runs)
- Overview restructure — Today tab removed, its content merged into the top
  of Overview; Sales Momentum now has Today/Week/Month/Quarter
  by Machine chart bars now match property colors
- Header: History button + renamed Sync button, checkbox dialog for
  HAHA/Google Ads/Google Analytics (Zoho shown but disabled until built)
- Add Task, Add Inventory, Add Expense, Upload Receipt — all quick-add
  dialogs, reachable from the header quick-links menu
- Delete Expense now confirms before deleting
- Logo click → jumps to Overview
- Property edit — every property (including ones like Margie Salon missing a
  type) can now be edited from its detail view
- Inventory cost is now required when adding inventory — no more $0-cost
  entries slipping through
- Selecting "Inventory - Product Purchases" in Log an Expense now prompts you
  to use Add Product instead
- Untracked receipts — Upload Receipt creates an auto-task and a row on the
  new Receipts tab; matching it to a real expense auto-completes the task
- Fixed: empty product dropdown bug (race condition on page load — selects
  now refresh once the product catalog finishes loading)
- Product category tags — 24-category list on the Products tab, plus a
  Category Performance card (revenue/units by category, last 30 days).
  Needs migration 013 to hold data.
- Tasks & Calls page now has a Tasks / Calls / All toggle at the top — Calls
  shows every logged call across all properties/contacts, All merges both
  timelines
- Warning banners moved below the header (were appearing above it) and sized
  down

## Verification already done on my end
- Full JS syntax check (`node --check`) on the dashboard's script block
- HTML `<div>` open/close balance check
- `node build.js` ran clean, dashboard now shows **Version 1.9** in its
  header (bumped from 1.8 — confirms you're looking at this batch once
  deployed)
- `ops-dashboard.html`, all new migration files, all new backend files, and
  `dist/ops-dashboard.html` are copied into your folder

Once migrations 011–013 are run and you push/deploy, everything above goes
live except Zoho (still scoping) and the two Google integrations (need their
credentials set first, per steps 2–3).
