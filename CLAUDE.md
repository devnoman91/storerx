@AGENTS.md

# StoreRx — Claude Code Project Guide
AI Conversion Doctor for Shopify. Audits a store area by area (CRO + performance + SEO + images), scores it, explains what it finds and recommends how to solve it. The merchant makes every change — StoreRx never writes to the store.

**Full spec:** `docs/FEATURES.md` — read it before building any feature.
**Design/wireframes:** `docs/DESIGN.md` — read it before building any UI screen.

## Non-negotiable rules

1. **Code finds problems, AI explains and advises.** Every detectable issue is a deterministic rule in `app/rules/<page>.ts`. Never ask the LLM "does this page have reviews?".
2. **AI never writes to the store, full stop.** StoreRx detects, explains and recommends; the merchant makes every change. Where a rule's problem is solved is declared in `app/remedies/catalog.ts` (`admin` / `settings` / `theme` / `messaging`) and the UI turns that into a contextual action. Copy StoreRx drafts (`Suggestion`) is shown for review and copying — never applied. Never add an apply/undo path, and never label anything "Fix with AI".
3. **No invented numbers.** Impact = High/Medium/Low. Never show "+X% conversion".
4. **All LLM calls use Structured Outputs** via the single wrapper `app/ai/generate.ts`. No free-text parsing. No direct `openai` imports elsewhere.
5. **No LLM/Lighthouse/Playwright inside request handlers.** Everything heavy runs in the worker (`worker/`). The job queue is the `Audit` table itself — workers claim `pending` rows with `FOR UPDATE SKIP LOCKED`. No external broker.
6. **Storefront changes only via Theme App Extension** (`extensions/storerx-theme/`). Never modify merchant theme files.
7. Do not recommend "convert images to WebP" — Shopify CDN handles it.

## Stack

Shopify Remix app template · TypeScript · Polaris · Prisma/PostgreSQL (also the job queue) · Playwright · Lighthouse · sharp · OpenAI SDK · Theme App Extension.

## Layout

```
app/
  routes/            Remix routes (embedded admin UI)
  rules/             one file per page type: homepage.ts collection.ts product.ts cart.ts checkout.ts images.ts perf.ts
  rules/types.ts     Rule = { id, page, severity, check(ctx) => Finding | null }
  remedies/          where each rule's problem is solved + the actions offered
  suggestions/       drafted copy queue (per item, on request)
  issues/            issue identity, reconciliation across scans, persistence
  scoring/           score calculation + weights
  ai/generate.ts     generate(prompt, schema, opts) — the only OpenAI entry point
  ai/prompts/        one file per task (explain, description, faq, seo, alt, crosssell, imageQuality)
  collectors/        admin.ts (GraphQL), storefront.ts (Playwright), lighthouse.ts
components/        issue cards, recommendation panels, drafted-copy panel
worker/              poll-loop processors: audit, suggestions
extensions/storerx-theme/   app blocks: faq, trust-badges, crosssells, shipping-bar
prisma/schema.prisma
docs/FEATURES.md
```

## Conventions

- Rule IDs: `page.topic.detail` (e.g. `prod.reviews.fold`). Severity weights high=10 medium=5 low=2.
- Page rules read the parsed page through `pageFor(ctx.html)` (`app/rules/page.ts`) — never regex over raw HTML, which matches words in scripts, CSS and meta tags. Static HTML has no layout, so no rule may claim "above the fold" or "on mobile"; use structure ("in the section with the add-to-cart form").
- A rule returns `null` only when it checked and passed. When the page lacks what it needs (an empty cart, an unknown product) it returns `UNCHECKED` — otherwise the scan would count it as checked and resolve open issues it never looked at.
- Each rule is tested against the real Dawn pages in `tests/fixtures/dawn/`; build failing cases with `without()` from `tests/rules/helpers.ts`.
- Findings carry `evidence` (selector, text snippet, or screenshot crop path) — the UI shows it.
- Prompts include store context + brand voice metafield; outputs validated with zod before use.
- Log OpenAI token usage per shop (`AiUsage` table).
- Audit samples pages (home, 3 collections, 5 top products, cart) — never full crawl in the audit job.
- Every rule ID must have an entry in `app/remedies/catalog.ts`; `tests/remedies` fails otherwise.
- Issue lifecycle: `open` → `awaiting_verification` (merchant says they did it) → `resolved` (a scan confirmed it). Only a scan may resolve an issue.
- Use `shopify-plugin:shopify-admin` skill for Admin GraphQL, `shopify-plugin:shopify-polaris-app-home` for UI, `shopify-plugin:shopify-liquid` for extension blocks. Validate GraphQL with `validate_graphql_codeblocks` before committing.

## Commands

```
npm run dev            # shopify app dev
npm run worker         # audit worker (polls the Audit table)
npm test               # vitest (rules + scoring)
npx prisma migrate dev
```

## Skills

- `/storerx-audit` — add or modify audit rules, scoring, and AI prompts following the spec.
