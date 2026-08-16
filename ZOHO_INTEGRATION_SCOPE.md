# Zoho Integration — Scoping Notes

You asked for Zoho to connect to Chase (banking) and to Command Center, so bank transactions, sales, and expenses land in one general ledger instead of three disconnected systems. This is a real accounting-system integration — bigger and higher-stakes than Google Ads/Analytics (those are read-only reporting pulls; this one writes financial entries), so it's deliberately not built yet. What exists right now is just a placeholder pill on the Marketing tab so there's a landing spot for it later.

Before this can be built, I need decisions and access on these fronts:

## 1. Which Zoho product(s)
"Zoho" isn't one API — the pieces likely involved are different products with different APIs:
- **Zoho Books** (or Zoho Finance Suite) — the actual general ledger / accounting product. This is almost certainly the core of what you want.
- **Zoho Bank Feeds** — Zoho Books has built-in bank feed support for many banks. Worth checking whether Chase already shows up as a supported direct feed inside Zoho Books itself before building a custom Chase connection — that would remove an entire integration leg.

**Decision needed:** Do you already have a Zoho Books (or similar) subscription? If not, which plan, and do you want me to research plan tiers/pricing before you commit?

## 2. Chase banking access
Chase doesn't offer a simple public API for regular business banking — real-time transaction access typically goes through:
- **Zoho's own built-in bank feed** (if Chase is supported there — check this first, it's the easiest path and needs zero custom code from me).
- **A banking aggregator like Plaid** — if Zoho's native feed doesn't cover your Chase account type, Plaid is the standard way third-party apps read bank transactions, but it's its own paid integration with its own setup (Plaid developer account, Chase login linked through Plaid's secure flow, webhook handling).

**Decision needed:** Have you checked whether Chase Business Checking/Credit already connects natively inside Zoho Books' bank feeds? If yes, that likely resolves this whole section on its own. If no, I'd need you to set up a Plaid developer account before I can build anything here.

## 3. What actually needs to write TO the ledger
You mentioned "write entries to GL for expenses and sales" — I need the mapping rules:
- Which Command Center expense categories map to which Zoho chart-of-accounts codes? (The 39-category list already in Expenses would need a 1:1 or many:1 mapping to whatever accounts exist in your Zoho chart of accounts.)
- Does each sale (per machine, per day) become one GL entry, or should it roll up weekly/monthly?
- Commission payouts, owner reimbursements, and QMOS write-offs — same question, which account each maps to.
- Do you want this to be one-way (Command Center → Zoho) or eventually two-way (so a transaction categorized in Zoho also updates something back here)?

**Decision needed:** A chart of accounts export from Zoho (once you have one set up) so I can build the category mapping table.

## 4. Authentication
Zoho uses OAuth2 (similar pattern to the Google Ads/Analytics setup already built — a one-time browser consent produces a refresh token, stored as a Cloudflare secret). This part is low-risk and I can build it the same way once the product/account decisions above are settled — it just needs a Zoho API console app registered under your Zoho account (I can walk you through that step when we get here, same as the Google OAuth setup).

## Suggested order once you're ready
1. Confirm Zoho product + plan, and get it provisioned.
2. Check Chase bank feed support inside Zoho Books directly — this alone might resolve most of the "banking data in Zoho" ask with no custom code.
3. Export your Zoho chart of accounts so we can build the category mapping.
4. I build the OAuth connection + a one-way sync (Command Center expenses/sales → Zoho GL entries) as a first version, before considering anything two-way.

Nothing here blocks anything else already shipped — this is purely a "when you're ready" list.
