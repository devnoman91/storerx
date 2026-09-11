# StoreRx — Ready-to-paste design prompts

Two prompts to use together with `docs/DESIGN.md`.
Paste the prompt first, then attach/paste the full DESIGN.md content where it says so.

---

## A. Prompt for an AI design tool (design / mockups)

Use in an AI design tool when you want visual mockups of the screens.

```
You are designing the UI for "StoreRx", a Shopify embedded admin app
(AI Conversion Doctor: it audits a store, scores it, and fixes issues
with AI after merchant approval).

I'm pasting the complete design spec below (DESIGN.md). Follow it
exactly — it defines the design system, branding, every screen's
wireframe, and 10 UX rules. Key constraints:

- Look and feel: Shopify admin / Polaris. Clean, white, lots of
  whitespace, subtle borders (#E1E3E5), rounded cards (12px), system
  font stack. NOT a generic SaaS dashboard.
- Colors: white background, dark text (#1A1F2E). Meaning colors only:
  red = high priority, yellow = medium, green = good, blue = info.
  Brand blue #0B4F8A is used sparingly (logo, primary buttons).
- Medical metaphor in copy: Diagnosis, Prescriptions, "Fix with AI".
- Sentence case, calm voice, no exclamation marks, no emoji.
- Mobile-responsive: cards stack to one column.

Design these screens in this order, one artboard each, desktop 1280px
wide (plus a 390px mobile variant of the Overview):
1. Overview (store health ring 74/100, five score bars, 3 metric
   cards, top prescriptions list)
2. Overview — audit running state (progress "Scanning product pages 3/5")
3. Onboarding (setup guide checklist, first-run)
4. Prescriptions (table with severity badges, expanded row showing
   evidence screenshot + "why it matters" + Fix with AI button)
5. Fix preview modal (before/after side by side, editable after,
   Discard / Regenerate / Approve & apply)
6. Page detail (mobile screenshot + issues list + performance metrics
   + app script weight table)
7. Images (table with thumbnails, problem badges, bulk "Generate all
   alt texts")
8. Settings (brand voice textarea, audit schedule, save bar)
9. Plans (4 pricing cards, current plan highlighted, usage meter)

--- DESIGN.md content starts below ---
[PASTE docs/DESIGN.md HERE]
```

---

## B. Prompt for Google Stitch

Stitch works best with one screen per prompt. Start a project with the
master prompt, then generate screens one at a time with the per-screen
lines. Don't paste the whole MD into Stitch — it's too long; the master
prompt carries the style.

### Master prompt (paste first / into project description)

```
Design a Shopify embedded admin app called "StoreRx" (AI Conversion
Doctor — audits a Shopify store, scores its conversion health 0–100,
lists prioritized issues as "prescriptions", and fixes them with AI
after merchant approval).

Style: Shopify Polaris admin design language. Clean and white:
white background, dark slate text #1A1F2E, subtle gray borders
#E1E3E5, rounded 12px cards with light shadows, system font
(SF Pro / Segoe UI), generous whitespace. Accent colors carry meaning
only: red badge = high priority, yellow = medium, green = healthy,
blue #0B4F8A for primary buttons and links. Sentence case, calm
professional copy, medical metaphor (diagnosis, prescriptions).
No dark theme, no gradients, no illustrations, no emoji.
Desktop web app, 1280px, left content max-width 950px centered.
```

### Per-screen prompts (generate in order)

```
1) Overview dashboard: page title "Overview" with primary button
"Run audit". A red alert banner "3 high-priority problems are hurting
your conversion". A "Store health" card with a big circular score
74/100 on the left and five labeled progress bars on the right
(Conversion 71, UX 82, Performance 76, SEO 84, Product pages 63 —
bars colored red under 50, yellow 50–79, green 80+). Below: three
small metric cards (Prescriptions: 8 open, Fixes applied: 12 this
month, Last audit: 2 days ago). Bottom card "Top prescriptions" with
three rows, each a colored severity dot, issue text, and a "Fix it"
button.
```

```
2) Same Overview but auditing: the store health card is replaced by a
progress card with a spinner, text "Running your check-up…",
"Scanning product pages 3/5", a progress bar at 60%, and a Cancel
text button.
```

```
3) Onboarding screen "Welcome to StoreRx": a setup guide card with a
4-step checklist (App installed ✓ done; Run your first store check-up
with a "Run now" button; Review your prescriptions; Apply your first
AI fix) and a short paragraph explaining the check-up takes ~2 minutes.
```

```
4) Prescriptions list: search field and filter chips (All, High,
Medium, Good). A table with columns Priority (colored badge), Issue,
Page, Action. 5 rows mixing severities. One row is expanded showing:
a small screenshot thumbnail, two sentences explaining why it
matters, an impact badge "High", and buttons "Fix with AI" and
"How to fix manually".
```

```
5) Fix preview modal over a dimmed page: title "Fix: Product
description — Blue Runner Shoes". Two columns: "Before" (gray card
with current text) and "After" (green-tinted card with AI text in an
editable textarea). Info banner "Nothing changes until you approve."
Footer buttons: Discard, Regenerate, and primary "Approve & apply".
```

```
6) Product page detail: back arrow + title "Product: Blue Runner
Shoes". Two score cards (CRO 63, Performance 71). Left card: mobile
screenshot of a product page with 2 issue pins. Right card: "Issues
(6)" list with severity badges and Fix buttons. Bottom card
"Performance": LCP 3.1s, CLS 0.02, INP 180ms, and a small table of
app scripts with sizes (one row flagged yellow "App X — 412 KB").
```

```
7) Images screen: title "Images", primary button "Generate all alt
texts". Filter chips (Missing alt, Too large, Low quality, All).
Table rows: image thumbnail, product name, problem badge, file size,
Fix button. Checkbox column with 2 selected and a bulk action bar.
```

```
8) Settings: sections "Brand voice" (large textarea with helper
text), "Audit schedule" (select: Weekly), "Email" (toggle: Send audit
summary email, on), "Excluded pages" (text field). A save bar at the
top with Save and Discard buttons.
```

```
9) Plans: four pricing cards in a row — Free, $19 Starter, $49
Growth (highlighted "Current plan"), $99 Pro — each with a short
feature list and an Upgrade button. Below: a usage meter card "AI
generations used: 34 / 100 this month" with a progress bar.
```
