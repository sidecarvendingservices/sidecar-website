# Deploying Phase 3: Team + Cloudflare Access identity

## What's new
- A **Team** tab: add employees/contractors with a name, login email, role (Owner, Account Manager, Stocker, Admin), phone, status.
- Properties now have an **Account Manager** and **Stocker** — set from a property's detail view (Team Assignment card) or when adding a new property. Every machine at that property inherits both automatically; there's nothing to set per machine.
- The dashboard now shows **"Logged in as [Name]"** in the top header, matched by your Cloudflare Access login email against the Team list.
- Tasks: the Owner dropdown now populates from Team instead of a hardcoded Brian/Vala list. Picking a Property on a new task defaults Owner to that property's Account Manager (only if Owner is still "Unassigned" — it won't override a manual pick). A **My Tasks** toggle appears next to the task filters once you're matched to a Team record.

## One-time setup — run this migration
```
npx wrangler d1 execute sidecar-ops --remote --file=migrations/009_team.sql
```
This creates the `team_members` table and adds `account_manager_id`/`stocker_id` columns to `properties`.

**Important:** until this migration runs, the Properties tab will show "no properties yet" and prompt for the migration — the properties list depends on a join against `team_members` now, so it degrades safely rather than erroring, but it will look empty in the meantime. Run the migration right after this deploy goes live, same as the last two phases.

## Add yourself and Vala to Team
Once deployed, go to the **Team** tab and add a record for yourself and Vala — email must exactly match the email each of you logs into the dashboard with via Cloudflare Access (Settings → whichever identity provider you're using there). That's what makes "Logged in as" and My Tasks work; nothing else needs configuring since Access is already on for the whole domain.

## Nothing else to configure
No new secrets, no new bindings — this only touches D1 (already bound) and reads a header Cloudflare Access already sets on every request.
