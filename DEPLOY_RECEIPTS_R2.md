# Setting up receipt storage (Cloudflare R2)

Expense receipts (photos/PDFs) upload to a Cloudflare R2 bucket via
`functions/api/data/receipt-upload.js`. Until the bucket exists and is bound
to the Pages project, receipt upload will show an error but everything else
on the Expenses tab keeps working normally — this isn't a blocking step.

## One-time setup (Cloudflare dashboard — no CLI needed)

1. Cloudflare dashboard → **R2 Object Storage** (left sidebar) → **Create bucket**.
   - Name it something like `sidecar-receipts`.
   - Location: Automatic is fine.
2. Go to **Workers & Pages** → **sidecar-website** (your Pages project) →
   **Settings** → **Functions** → scroll to **R2 bucket bindings** → **Add binding**.
   - Variable name: `RECEIPTS` (must match exactly — this is what
     `env.RECEIPTS` in the code refers to).
   - R2 bucket: the `sidecar-receipts` bucket you just created.
3. Save. Cloudflare Pages redeploys automatically when you save a binding
   change, or trigger a redeploy yourself (Deployments tab → Retry on the
   latest one) if it doesn't.

That's it — no secrets, no CLI commands. Once the binding is saved, "Add
Expense" will let you attach a receipt, and a "View Receipt" link appears on
any expense that has one.

## Notes
- Max file size is 15MB; accepted types are JPG, PNG, HEIC, WebP, and PDF.
- Files are stored under `receipts/YYYY-MM-DD/<random-id>-<filename>` in the
  bucket — safe to browse directly in the R2 dashboard if you ever need to.
- If you ever want to delete a receipt without deleting the whole expense,
  that's not wired into the UI yet — deleting the expense itself does not
  currently delete the underlying R2 object (a rare, low-cost orphan is fine
  for now; can revisit if it matters later).
