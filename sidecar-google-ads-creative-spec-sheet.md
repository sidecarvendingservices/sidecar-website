# Sidecar Vending — Google Ads Creative Spec Sheet
*Responsive Display Ads, repurposed from Instagram carousel graphics*

Last updated: August 2026

## 1. Why Responsive Display Ads

Google auto-assembles your uploaded images, logo, and text into whatever ad slot it's placing (Display Network sites, Gmail, YouTube). You don't hand-build every legacy banner size — you supply a small set of image ratios and let Google do the resizing/placement. This is the lowest-effort path for turning existing carousel art into running ads.

## 2. Required Image Specs

| Asset | Ratio | Recommended size | Minimum size | Required? |
|---|---|---|---|---|
| Landscape image | 1.91:1 | 1200×628 px | 600×314 px | Yes — at least 1 |
| Square image | 1:1 | 1200×1200 px | 300×300 px | Yes — at least 1 |
| Portrait image | 4:5 | 1200×1500 px | — | Optional (extra placement coverage) |
| Logo, square | 1:1 | 1200×1200 px | — | Recommended |
| Logo, landscape | 4:1 | 1200×300 px | — | Recommended |

General rules: JPG, PNG, or static GIF, under 5MB each. You can upload up to 15 images per ratio (Google tests combinations automatically), but 2–3 strong variants per ratio per industry is plenty to start. Keep text overlay under ~20% of the image area — Google's system down-ranks image-heavy-text assets, and it hurts approval odds.

## 3. Text Assets (per ad group)

| Field | Limit | Minimum needed | Notes |
|---|---|---|---|
| Short headline | 30 characters | 3 (up to 5) | e.g. "Free Vending for Your Property" |
| Long headline | 90 characters | 1 | Used in larger placements |
| Description | 90 characters | 2 (up to 5) | e.g. "Snacks, drinks, meal replacements, essentials — stocked free, on us." |
| Business name | 25 characters | 1 | "Sidecar Vending Services" |

## 4. Converting Carousel Slides Into Ad Images

Your Instagram carousels are built at social dimensions (square 1080×1080 or portrait 1080×1350), which don't match the landscape ratio Google requires, and the multi-slide format doesn't translate to a single static ad. For each industry:

1. Pick the single strongest slide/concept (usually the "here's everything we stock" hero shot or the top 3–4 product icons), not the full carousel sequence.
2. Rebuild it as new artboards at 1200×1200 (square) and 1200×628 (landscape) in Photoshop/Figma, keeping your existing product photography, colors, and logo — the landscape version will need the composition reflowed (wider, shorter), not just cropped.
3. Keep on-image text minimal: a short value line is fine ("Free vending, fully stocked"), but let the headline/description fields (Section 3) carry the detail — that's what Google actually optimizes and swaps automatically.

## 5. File Naming Convention

`sidecar-[industry]-[ratio]-[variant#].jpg`

Examples:
- `sidecar-apartment-square-1.jpg`
- `sidecar-apartment-landscape-1.jpg`
- `sidecar-gym-square-1.jpg`
- `sidecar-gym-landscape-1.jpg`

## 6. Industry / Ad Group Breakdown

Matches the property types already in your website's evaluation form — build one ad group per row, each with its own creative and landing link.

| Industry | Source carousel | Suggested angle | Landing link (with UTM) |
|---|---|---|---|
| Apartment Community | Apartment product-mix carousel | "Snacks, drinks, meal replacements & essentials — free for your residents" | `/#evaluation?utm_source=google&utm_medium=display&utm_campaign=apartment` |
| Gym / Fitness Center | (build if not yet made) | Protein, hydration, recovery items | `/#evaluation?utm_source=google&utm_medium=display&utm_campaign=gym` |
| Office | (build if not yet made) | Snacks/drinks for break rooms, zero-cost perk | `/#evaluation?utm_source=google&utm_medium=display&utm_campaign=office` |
| Medical Facility | (build if not yet made) | Convenience for staff/visitors, 24/7 access | `/#evaluation?utm_source=google&utm_medium=display&utm_campaign=medical` |
| Auto Dealership | (build if not yet made) | Waiting-room convenience for customers | `/#evaluation?utm_source=google&utm_medium=display&utm_campaign=auto-dealership` |
| Warehouse / Distribution | (build if not yet made) | Break-room essentials for shift workers | `/#evaluation?utm_source=google&utm_medium=display&utm_campaign=warehouse` |

Start with whichever 1–2 industries you already have finished carousel art for (apartment, based on our earlier conversation), confirm the format works and converts, then extend to the rest.

## 7. Before You Launch

- Confirm your Google Ads account has conversion tracking wired to the `/thank-you.html` page (this is the same page your new evaluation form already redirects to) so Display campaign results are measurable.
- Each ad group's headline/description copy should roughly match the on-page content it links to, for Google's Quality Score and so visitors aren't confused by a mismatch between ad and landing page.
- Don't reuse the exact same creative across every industry — the whole value of doing this per-vertical is speaking to each property type's specific pain point.

---
Sources:
- [Google Ads Display Ad Sizes: 2026 Specs Cheat Sheet](https://lineardesign.com/blog/google-ads-display-ad-sizes/)
- [Google Ads Character Limits 2026 Guide](https://clickpatrol.com/google-ads-character-limits-2026-guide-headlines/)
