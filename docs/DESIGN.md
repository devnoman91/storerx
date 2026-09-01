# StoreRx — Design, Wireframes & Branding

This file is the design source of truth for Claude when building any UI screen.
Read together with `docs/FEATURES.md`. All screens are built with **Polaris web components**
(`s-*` tags, globally available, no imports) inside the embedded app.

---

## 1. Shopify design ecosystem (rules we must follow)

- **Embedded app** in Shopify admin via App Bridge; navigation, title bar and toasts come from the admin shell.
- **Polaris web components**: `s-page`, `s-section`, `s-box`, `s-stack`, `s-grid`, `s-table`,
  `s-badge`, `s-banner`, `s-button`, `s-modal`, `s-text`, `s-heading`, `s-select`, `s-switch`,
  `s-search-field`, `s-thumbnail`, `s-spinner`, `s-divider`, `s-link`, `s-icon`, `s-tooltip`.
  Kebab-case attributes (`grid-template-columns`, not camelCase). Never import `@shopify/polaris`.
- **Page templates** (use these, don't invent layouts): **Homepage** (Overview), **Index**
  (Prescriptions, Pages, Images, Fixes), **Details** (Page detail, Fix preview), **Settings**.
- **Ready patterns**: Setup guide (onboarding), Metrics card (scores), Index table (lists),
  Empty state, Callout card, Footer help.
- **Colors are Polaris tones, not brand hex.** Inside the admin we express meaning through
  `tone`: `critical` (red), `warning` (yellow), `success` (green), `info` (blue), `neutral`.
  Custom brand colors are only for the logo, App Store listing, and marketing site.
- **Built for Shopify quality bar**: mobile-responsive admin, no layout shift, loading states
  for everything async, Save Bar for unsaved settings, contextual empty states, App Bridge Toast
  for confirmations, no external fonts.

---

## 2. Branding

| Element | Decision |
|---|---|
| Name | **StoreRx** — "the prescription for your store" |
| Tagline | Diagnose. Optimize. Convert. |
| Concept | Medical metaphor used consistently: **Diagnosis** (audit) → **Prescriptions** (issues) → **Treatment** ("Fix with AI") → **Recovery** (score trend) |
| Logo | Rx ligature in a rounded square; brand blue `#0B4F8A` on white; white on blue for dark contexts. Marketing/App Store only. |
| Brand colors (marketing only) | Primary `#0B4F8A` blue · accent `#0FA36B` green · alert `#C43D3D` red · ground `#F4F7FB` |
| In-admin colors | Polaris tones only: critical = high priority, warning = medium, success = good/healthy, info = neutral tips |
| Voice | Doctor who explains simply: calm, specific, no hype, no blame. "Your product pages are missing reviews above the fold" — never "Your store is bad". Always say **why it matters** in one sentence. |
| Numbers | Scores 0–100. Impact only High / Medium / Low. Never invented percentages. |
| Iconography | Polaris `s-icon` set only in-admin. Emoji (🩺 💊 📈) allowed in marketing, never in the embedded UI. |
| Empty/loading language | Medical framing: "Running your check-up…", "No prescriptions — your store is healthy 🎉" (text only, no emoji in admin: "No prescriptions — your store is healthy.") |

---

## 3. App structure (navigation)

```
StoreRx (embedded app nav)
├── Overview            /app                    Homepage template
├── Prescriptions       /app/prescriptions      Index template
├── Pages               /app/pages              Index template
│   └── Page detail     /app/pages/:id          Details template
├── Images              /app/images             Index template
├── Fixes               /app/fixes              Index template
│   └── Fix preview     modal on any screen
├── Settings            /app/settings           Settings template
└── Plans               /app/plans              Settings template (billing)
Onboarding (first run)  /app  → Setup guide pattern replaces Overview until first audit
```

---

## 4. Wireframes

### 4.1 Overview (Homepage template) — `/app`

```
┌─ s-page "Overview" ──────────────────────────────── [Run audit ▸] ─┐
│                                                                    │
│ ┌ s-banner tone=critical (only if high issues) ─────────────────┐  │
│ │ 3 high-priority problems are hurting your conversion  [View]  │  │
│ └───────────────────────────────────────────────────────────────┘  │
│                                                                    │
│ ┌ s-section "Store Health" ─────────────────────────────────────┐  │
│ │   ┌────────┐   Conversion  71   ▉▉▉▉▉▉▉░░░                    │  │
│ │   │  74    │   UX          82   ▉▉▉▉▉▉▉▉░░                    │  │
│ │   │ /100   │   Performance 76   ▉▉▉▉▉▉▉▉░░                    │  │
│ │   └────────┘   SEO         84   ▉▉▉▉▉▉▉▉░░                    │  │
│ │  (big score)   Product pg  63   ▉▉▉▉▉▉░░░░                    │  │
│ │  s-grid 2 cols; bars = s-box with width %; trend sparkline    │  │
│ └───────────────────────────────────────────────────────────────┘  │
│                                                                    │
│ ┌ s-grid 3 cols (Metrics cards) ────────────────────────────────┐  │
│ │ [ Prescriptions ] [ Fixes applied ] [ Last audit ]            │  │
│ │   8 open             12 this month    2 days ago              │  │
│ └───────────────────────────────────────────────────────────────┘  │
│                                                                    │
│ ┌ s-section "Top prescriptions" ────────────────────────────────┐  │
│ │ ● s-badge critical  Product pages lack reviews     [Fix it]   │  │
│ │ ● s-badge warning   Mobile CTA hard to find        [View]     │  │
│ │ ● s-badge warning   42 images missing alt text     [Fix it]   │  │
│ │                                  s-link "View all" →          │  │
│ └───────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────┘
```

**Audit running state** (replaces Store Health section):
```
┌ s-section ─────────────────────────────────────────┐
│ s-spinner  Running your check-up…                  │
│ Scanning product pages  3/5                        │
│ s-box progress bar (width %)   [Cancel]            │
└────────────────────────────────────────────────────┘
```

### 4.2 Onboarding (first run) — Setup guide pattern

```
┌ s-page "Welcome to StoreRx" ───────────────────────┐
│ ┌ Setup guide ─────────────────────────────────┐   │
│ │ ✓ App installed                              │   │
│ │ ○ Run your first store check-up   [Run now]  │   │
│ │ ○ Review your prescriptions                  │   │
│ │ ○ Apply your first AI fix                    │   │
│ └──────────────────────────────────────────────┘   │
│ s-paragraph: what StoreRx checks, ~2 minutes.      │
└────────────────────────────────────────────────────┘
```

### 4.3 Prescriptions (Index template) — `/app/prescriptions`

```
┌ s-page "Prescriptions" ──────────────────── [Run audit ▸] ─┐
│ s-search-field | filter chips: All · High · Medium · Good  │
│ ┌ s-table ────────────────────────────────────────────────┐│
│ │ Priority       Issue                    Page     Action ││
│ │ ● critical     No reviews above fold    Product  [Fix]  ││
│ │ ● critical     Guest checkout off       Checkout [View] ││
│ │ ● warning      Description 38 words     Product  [Fix]  ││
│ │ ● warning      No free-shipping bar     Cart     [Fix]  ││
│ │ ● success      Images optimized         —        ✓      ││
│ └─────────────────────────────────────────────────────────┘│
│ Row click → expands: why it matters (1–2 sentences),       │
│ evidence (screenshot crop s-image), impact s-badge,        │
│ [Fix with AI] or [How to fix manually]                     │
└────────────────────────────────────────────────────────────┘
```

### 4.4 Fix preview (s-modal, opened from anywhere)

```
┌ s-modal "Fix: Product description — Blue Runner Shoes" ────┐
│ s-grid 2 cols                                              │
│ ┌ BEFORE (s-box subdued) ┐  ┌ AFTER (s-box success bg) ┐   │
│ │ current text…          │  │ AI text… (editable       │   │
│ │                        │  │ s-text-area)             │   │
│ └────────────────────────┘  └──────────────────────────┘   │
│ s-banner info: "Nothing changes until you approve."        │
│           [Discard]  [Regenerate]  [Approve & apply ▸]     │
└────────────────────────────────────────────────────────────┘
→ on apply: App Bridge Toast "Fix applied — Undo available in Fixes"
```

### 4.5 Pages (Index) — `/app/pages` and Page detail (Details)

```
Index: s-table — Page · CRO score · Perf score · Issues · Last scan
Row → /app/pages/:id

┌ s-page "Product: Blue Runner Shoes" ◂ back ────────────────┐
│ s-grid: [CRO 63] [Perf 71] metrics cards                   │
│ ┌ s-section "Screenshot" ─┐ ┌ s-section "Issues (6)" ────┐ │
│ │ s-image mobile shot     │ │ ● critical … [Fix]         │ │
│ │ (issues pinned)         │ │ ● warning  … [Fix]         │ │
│ └─────────────────────────┘ └────────────────────────────┘ │
│ ┌ s-section "Performance" ─────────────────────────────────┐│
│ │ LCP 3.1s · CLS 0.02 · INP 180ms                          ││
│ │ s-table: App scripts — App X 412 KB ● warning …          ││
│ └──────────────────────────────────────────────────────────┘│
└────────────────────────────────────────────────────────────┘
```

### 4.6 Images (Index) — `/app/images`

```
┌ s-page "Images" ────────────── [Generate all alt texts ▸] ─┐
│ filter chips: Missing alt · Too large · Low quality · All  │
│ s-table: s-thumbnail · Product · Problem badge · Size ·    │
│          [Fix] per row; bulk select → bulk actions         │
└────────────────────────────────────────────────────────────┘
```

### 4.7 Fixes (Index) — `/app/fixes`

```
s-table: Date · Type · Target · Status badge
status: preview (attention) / applied (success) / undone (neutral)
Row actions: [View diff] [Undo] (undo available 30 days)
```

### 4.8 Settings — `/app/settings` (Settings template + Save Bar)

```
s-section "Brand voice"    s-text-area (paste 2–3 paragraphs)
s-section "Audit schedule" s-select: Weekly / Monthly / Manual
s-section "Email"          s-switch: Send audit summary email
s-section "Excluded pages" s-text-field list
→ any change shows App Bridge Save Bar (Save / Discard)
```

### 4.9 Plans — `/app/plans`

```
s-grid 4 cols (1 col mobile): Free / $19 / $49 / $99
each: s-box border=base (current plan: border strong + badge
"Current"), feature s-unordered-list, [Upgrade] s-button
primary on recommended tier. Usage meter: "AI generations
used: 34 / 100 this month" (s-box bar).
```

---

## 5. UX rules (apply everywhere)

1. **Severity mapping** (never deviate): high → `tone="critical"`, medium → `tone="warning"`,
   good/passed → `tone="success"`, info → `tone="info"`.
2. **Every async thing has a state**: loading (`s-spinner` or skeleton `s-box`), empty
   (Empty state pattern with one primary action), error (`s-banner tone="critical"` with retry).
3. **One primary button per page** (`variant="primary"`). Usually "Run audit" or "Approve & apply".
4. **Destructive/irreversible = confirm modal**; applying a fix is NOT destructive (undo exists)
   so it needs no confirm — preview modal is the confirmation.
5. **Toasts** (App Bridge) for success only; banners for problems.
6. **Mobile**: `s-grid` collapses to 1 column; tables use `variant="auto"` (list on narrow).
7. **Scores**: colored by band — 0–49 critical, 50–79 warning, 80–100 success.
8. **Never block the UI during an audit** — merchant can browse other screens; progress lives
   on Overview and as a subtle badge on the nav item.
9. **Footer help** pattern on every page: link to docs + support email.
10. **Text style**: sentence case everywhere (Shopify convention), no ALL CAPS, no exclamation
    marks in body copy.

---

## 6. Screen → build order (matches timeline)

| Stage 1 day | Screen |
|---|---|
| 20 | Overview + audit progress + onboarding setup guide |
| 21 | Prescriptions index + row expand |
| 22 | Fix preview modal + Fixes index |
| 23 | Settings + Plans |
| 24 | Pages index + Page detail + Images |

Validate every screen's JSX with the Polaris skill validator before committing
(`shopify-plugin:shopify-polaris-app-home` → `validate.mjs`).
