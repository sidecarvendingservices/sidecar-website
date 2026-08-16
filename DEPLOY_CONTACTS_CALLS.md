# Deploying Phase 5: Contacts overhaul + Tasks & Calls

## What's new
- **Contacts** is now its own top-level tab — every property manager and prospect in one searchable list, not buried inside each property's modal.
- Contacts no longer require a Property. Leave it blank to track a **prospect** (with an optional free-text Company field) — link a Property later once they're placed.
- **Tasks** is relabeled **Tasks & Calls**. Quick Add (top header) already has New Task / New Contact / Schedule Call / Log Call — those now work without a Property too, for prospect outreach.
- **Cross-linked history**: Property, Machine, and Contact detail views now show one merged "Tasks & Calls History" — completed/open tasks and logged calls together, sorted by date — instead of three disconnected lists. Logging a call or completing a task from anywhere shows up on every related record.
- Nav reorder: Overview, Today, Tasks & Calls, Team, Properties, Machines, Contacts, Inventory, Expenses, Sales.

## One-time setup — run this migration
```
npx wrangler d1 execute sidecar-ops --remote --file=migrations/010_contacts_calls.sql
```
This rebuilds `contacts` and `activity_log` (SQLite has no ALTER COLUMN, so it's a copy-and-swap — your existing contacts and call history are preserved) to make `property_id` optional and add a `company` field to contacts.

**Until this runs:** adding a contact without a property, or logging a call against a contact-only record, will fail with a clear error (property_id is still required at the DB level) — everything else keeps working normally.

## Nothing else to configure
No new secrets or bindings — this is D1 schema + dashboard changes only.
