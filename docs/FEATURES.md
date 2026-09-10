# StoreRx — Functional Specification

> **Tagline:** Diagnose. Optimize. Convert.
> AI conversion doctor for Shopify: audits a store page-by-page, scores CRO + performance, prescribes fixes, and applies them with merchant approval.

---

## 1. Core Principle

**Code finds problems. AI explains and fixes them.**

- Deterministic **rule engine** detects issues (consistent, testable, cheap).
- **OpenAI** explains findings in merchant language, prioritises, and generates fixes.
- AI **never writes to the store without merchant approval**. Every fix = preview → approve → apply → undo available.
- No fake numbers. Impact is shown as High / Medium / Low, never "+12% conversion".

---

## 2. Audit Pipeline

```
Shopify store
  │
  ├─ Admin GraphQL  → products, collections, media, theme, apps, shop settings, top sellers
  ├─ Playwright     → HTML + screenshots (mobile 390px + desktop 1440px) per page
  └─ Lighthouse     → Performance score, LCP, CLS, INP, TBT, script weight
          │
          ▼
  Rule engine (rules/<page>.ts) → findings[] {id, severity, evidence, page, fixableByAI}
          │
          ▼
  Scoring → per-page CRO score + Perf score → overall Store Health
          │
          ▼
  OpenAI (structured outputs) → explanations, priority, recommendations
          │
          ▼
  Dashboard → Prescriptions → "Fix with AI" → Preview → Approve → Apply (Admin API / Theme App Extension)
```

**Pages sampled per audit** (not full crawl):
- Homepage
- 3 collections (largest by product count)
- 5 products (top sellers from last 30 days of orders; fallback: newest)
- Cart
- Checkout settings (read via Admin API, not crawled)

Audits run as **background jobs**. The `Audit` table is the queue: the worker claims `pending` rows with `SELECT ... FOR UPDATE SKIP LOCKED`, which is atomic, so multiple workers are safe and no external broker is needed. UI shows progress: "Scanning product pages… 3/5". Typical duration 1–3 min.

> Why not BullMQ/Redis: audit volume is ~1 job per shop per week, and the job payload is already a row in Postgres. A broker would be a second datastore, a second bill, and — on per-command pricing — a standing charge for an idle worker's polling. Revisit if job volume or fan-out grows.

---

## 3. Store Health Scores

| Score | Source |
|---|---|
| **Overall Store Health** (0–100) | Weighted average of below |
| Conversion (CRO) | Rule engine, all pages |
| UX | Mobile-specific rules + layout checks |
| Performance | Lighthouse (mobile weighted 70%, desktop 30%) |
| SEO | Meta, titles, alt text, structured data, headings |
| Product Pages | Product-page rules + image checks |

Scoring = 100 − Σ(severity weight × issue count), capped per category.
Severity weights: high = 10, medium = 5, low = 2.

Score history is stored per audit → **trend graph** over time (weekly audit tier).

---

## 4. Page-by-Page Checks

### 4.1 Homepage
| Rule ID | Check | Severity |
|---|---|---|
| home.hero.cta | Hero headline + CTA visible above fold on mobile | high |
| home.announcement | Announcement bar / shipping promise present | medium |
| home.featured | Featured collections or products in first 2 screens | medium |
| home.trust | Trust elements (reviews, badges, press, guarantees) | high |
| home.popups | > 1 popup on load | medium |
| home.nav | Main nav ≤ 7 items, has Search | low |
| home.contact | Contact / About / Policies links in footer | medium |

### 4.2 Collection
| Rule ID | Check | Severity |
|---|---|---|
| coll.filters | Filter + sort available | medium |
| coll.card.price | Price visible on product cards | high |
| coll.card.atc | Quick add-to-cart on cards | low |
| coll.thin | Collection has < 4 products | medium |
| coll.image.consistency | Card images have mixed aspect ratios | medium |
| coll.description | Collection has description (SEO) | low |
| coll.empty | Empty collections published | high |

### 4.3 Product (heaviest)
| Rule ID | Check | Severity |
|---|---|---|
| prod.reviews.fold | Reviews / rating visible above fold | high |
| prod.cta.sticky | Sticky add-to-cart on mobile | medium |
| prod.price.near.cta | Price, variants, stock, delivery info near CTA | high |
| prod.desc.short | Description < 80 words | medium |
| prod.desc.long | Description > 600 words with no structure | low |
| prod.faq | FAQ / size guide / shipping & returns section | medium |
| prod.trust.badges | Trust badges near CTA | medium |
| prod.crosssell | Cross-sells / related products / bundles | medium |
| prod.variants.oos | Out-of-stock variants not marked | high |
| prod.seo.title | SEO title missing or > 60 chars | medium |
| prod.seo.meta | Meta description missing or > 160 chars | medium |
| prod.schema | Product structured data (JSON-LD) missing | low |

### 4.4 Cart
| Rule ID | Check | Severity |
|---|---|---|
| cart.drawer | Cart drawer (vs full page) | low |
| cart.shipping.bar | Free-shipping progress bar | medium |
| cart.upsell | Upsells / add-ons in cart | medium |
| cart.trust | Trust badges near checkout button | medium |
| cart.discount.prominent | Discount field very prominent (encourages coupon hunting) | low |
| cart.express | Express checkout buttons shown | medium |

### 4.5 Checkout (Admin API only — Shopify controls layout)
| Rule ID | Check | Severity |
|---|---|---|
| chk.express | Shop Pay / Apple Pay / Google Pay enabled | high |
| chk.guest | Guest checkout allowed | high |
| chk.shipping.options | ≥ 2 shipping options | low |
| chk.payment.options | ≥ 2 payment methods | medium |
| chk.tipping | Tipping enabled on non-service store | low |

---

## 5. Image Audit

Runs on all product images (separate job, paginated).

### Deterministic checks
| Rule ID | Check | Threshold | Severity |
|---|---|---|---|
| img.size | File size | > 500 KB | medium |
| img.dims.large | Dimensions | > 2048px | low |
| img.dims.small | Dimensions | < 800px | medium |
| img.alt | Alt text missing | — | medium (SEO + a11y) |
| img.ratio | Mixed aspect ratios within a product | — | medium |
| img.count | Images per product | < 3 | medium |
| img.duplicate | Duplicate images (hash) | — | low |
| img.lazy | Not lazy-loaded / no srcset (theme level) | — | low |

> Shopify CDN already serves WebP/AVIF and resizes — do **not** recommend "convert to WebP".

### AI vision checks (OpenAI, first image per product by default; all images on $49+)
Structured output per image:
```json
{
  "background_clean": true,
  "product_centered": false,
  "is_lifestyle_shot": false,
  "has_watermark_or_text": true,
  "blurry_or_low_quality": false,
  "issues": ["watermark", "off-center"]
}
```
Flags: cluttered background, watermark/text overlay, off-center, blurry, poor lighting. Subjective items (dull colours) are suggestions, not red flags.

### Image fixes
| Fix | Method | Tier |
|---|---|---|
| Generate alt text | OpenAI vision → `productUpdate` media alt | Free+ |
| Compress oversized image | sharp → re-upload via `fileUpdate` after approval | $19+ |
| Background removal | Image edit API / remove.bg | $49+ |

---

## 6. Performance Audit

Per page (Lighthouse, mobile + desktop):
- Performance score, LCP, CLS, INP, TBT
- Total JS / CSS / image weight
- **App script weight breakdown** — which installed apps add how many KB to every page ("App X adds 400 KB"). Matched by script hostname → app name map.
- Render-blocking resources
- Fonts count
- Third-party requests count

Recommendations: remove unused apps, defer scripts, reduce hero image, limit fonts, enable theme lazy loading.

---

## 7. AI Layer (OpenAI)

Single wrapper: `ai.generate(prompt, schema, {model, images?})` — swappable to other providers.

| Task | Model | Notes |
|---|---|---|
| Explain findings + prioritise | gpt-4.1-mini | Input: findings JSON + store context. Output: JSON schema |
| Product description | gpt-4.1 | Input: title, current desc, variants, tags, brand voice sample |
| FAQ section | gpt-4.1-mini | 5–8 Q&A |
| SEO title + meta | gpt-4.1-mini | Length-constrained |
| CTA copy | gpt-4.1-mini | 3 options |
| Alt text | gpt-4.1-mini (vision) | ≤ 125 chars, describes product |
| Cross-sell picks | gpt-4.1-mini | Input: catalog summary |
| Image quality judgement | gpt-4.1-mini (vision) | Schema above |
| Layout judgement (optional) | gpt-4.1 (vision) | Screenshots; secondary signal only |

Rules:
- Always **Structured Outputs** (JSON schema) — never free text parsing.
- Store **brand voice** sample (merchant pastes 2–3 paragraphs) in app metafield; include in generation prompts.
- Retry with backoff; queue all calls; never call OpenAI inside HTTP request handlers.
- Log token usage per shop for cost tracking.

Cost estimate (2026 list prices, verify): ~$0.02 per audit explanation, ~$0.005–0.03 per fix, ~$1–2 per full-catalog vision scan (200 products × 4 images). LLM cost per merchant/month ≪ $1 at $19 tier.

---

## 8. Fix with AI — Workflow

1. Merchant clicks **Fix with AI** on a prescription.
2. Job generates the fix → stored as `Fix {id, shop, type, targetId, before, after, status: 'preview'}`.
3. UI shows **side-by-side before/after** (rich text diff for copy, image preview for images).
4. Merchant **Approve** / **Edit** / **Discard**.
5. Apply via Admin API (`productUpdate`, `fileUpdate`, `metafieldsSet`) or Theme App Extension settings.
6. `before` snapshot kept → **Undo** button for 30 days.
7. Bulk mode: select multiple products → generate → review list → approve all/individually.

Fix types:
| Fix | Target |
|---|---|
| Product description | `product.descriptionHtml` |
| SEO title / meta | `product.seo` |
| Alt text | `product.media[].alt` |
| FAQ block | Theme App Extension block (metafield-driven) |
| Trust badges | Theme App Extension block |
| CTA copy | Theme App Extension block / theme setting |
| Cross-sells | Metafield `storerx.crosssells` → extension block |
| Shipping bar | Theme App Extension block |

---

## 9. Storefront Integration (Theme App Extension)

App blocks (merchant adds in theme editor, no theme code edits):
- `storerx-faq` — renders FAQ from metafield
- `storerx-trust-badges` — configurable badge row
- `storerx-crosssells` — related products from metafield
- `storerx-shipping-bar` — free-shipping progress (cart drawer / cart page)

All blocks: lightweight, no external JS libs, < 10 KB, lazy where possible (must not hurt the store's own perf score).

---

## 10. Dashboard (Polaris, embedded app)

- **Overview:** Store Health ring, 5 category scores, trend sparkline, "3 critical issues" banner.
- **Prescriptions:** list grouped by severity (🔴 High / 🟡 Medium / 🟢 Good). Each card: title, why it matters, evidence (screenshot crop), impact, `[Fix with AI]` or `[View issue]`.
- **Pages:** page list with CRO + Perf scores → page detail with screenshot, issues, Lighthouse metrics.
- **Images:** table of flagged images, bulk alt-text generation.
- **Performance:** app script weight table, metrics per page.
- **Fixes:** history, pending previews, undo.
- **Settings:** brand voice, audit schedule, excluded pages, plan/billing.

---

## 11. Plans & Billing (Shopify Billing API)

| Plan | Price | Includes |
|---|---|---|
| Free | $0 | 1 audit/month, 5 AI recommendations, alt text for 20 images |
| Starter | $19/mo | Weekly audits, unlimited recommendations, product copy fixes, image compression |
| Growth | $49/mo | Unlimited audits, all AI fixes, full-catalog vision scan, background removal, A/B test hints, conversion analytics |
| Pro | $99/mo | Everything + multi-store, advanced analytics, priority support |

Usage caps on AI generations per plan to protect margins. 7-day trial on paid plans.

---

## 12. Data & Privacy

- Store only: shop domain, tokens, audit results, screenshots (30-day retention), fix snapshots.
- No customer PII collected. Orders read only for "top sellers" (aggregated).
- OpenAI API data not used for training (state in privacy policy).
- GDPR webhooks: `customers/data_request`, `customers/redact`, `shop/redact` implemented.
- Uninstall → delete all shop data within 48h.

---

## 13. Tech Stack

- **App:** Shopify Remix app template (Node 20, TypeScript), Polaris, App Bridge
- **DB:** PostgreSQL (Prisma)
- **Queue:** PostgreSQL (`Audit` table, `FOR UPDATE SKIP LOCKED`)
- **Crawl:** Playwright (Chromium), Lighthouse (node module)
- **Images:** sharp
- **AI:** OpenAI SDK (structured outputs, vision)
- **Storefront:** Theme App Extension (Liquid + minimal JS)
- **Hosting:** Fly.io / Railway (app + worker + Postgres)

---

## 14. MVP Scope (6–8 weeks)

1. Auth, billing (4 plans), Polaris shell
2. Product-page audit: 12 product rules + image deterministic checks
3. Lighthouse perf on product page + homepage
4. OpenAI explanation + 3 fixes: description, SEO title/meta, alt text — with preview/approve/undo
5. Overview + Prescriptions + Fixes screens
6. Weekly scheduled audit + email summary

**Post-MVP:** homepage/collection/cart rules, vision image checks, Theme App Extension blocks, app script weight table, trend graphs, multi-store.

---

## 15. Open Questions / Risks

- Traffic data (e.g. "73% of traffic hits product pages") requires a Web Pixel or analytics API — MVP shows structural findings without traffic %.
- Lighthouse on shared hosting is CPU-heavy → separate worker box, concurrency 1–2.
- Password-protected stores: use storefront password or theme preview URL.
- Name "StoreRx": verify trademark, domain, App Store name availability before launch.
