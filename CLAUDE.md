@AGENTS.md

# StoreRx — Claude Code Project Guide
AI Conversion Doctor for Shopify. Audits a store page-by-page (CRO + performance + SEO + images), scores it, prescribes fixes, and applies them with merchant approval.

**Full spec:** `docs/FEATURES.md` — read it before building any feature.
**Design/wireframes:** `docs/DESIGN.md` — read it before building any UI screen.

## Non-negotiable rules

1. **Code finds problems, AI explains/fixes.** Every detectable issue is a deterministic rule in `app/rules/<page>.ts`. Never ask the LLM "does this page have reviews?".
2. **AI never writes to the store without approval.** All fixes go through `Fix` (preview → approve → apply → undo). Keep the `before` snapshot.
3. **No invented numbers.** Impact = High/Medium/Low. Never show "+X% conversion".
4. **All LLM calls use Structured Outputs** via the single wrapper `app/ai/generate.ts`. No free-text parsing. No direct `openai` imports elsewhere.
5. **No LLM/Lighthouse/Playwright inside request handlers.** Everything heavy runs in BullMQ workers (`worker/`).
6. **Storefront changes only via Theme App Extension** (`extensions/storerx-theme/`). Never modify merchant theme files.
7. Do not recommend "convert images to WebP" — Shopify CDN handles it.

## Stack

Shopify Remix app template · TypeScript · Polaris · Prisma/PostgreSQL · BullMQ/Redis · Playwright · Lighthouse · sharp · OpenAI SDK · Theme App Extension.

## Layout

```
app/
  routes/            Remix routes (embedded admin UI)
  rules/             one file per page type: homepage.ts collection.ts product.ts cart.ts checkout.ts images.ts perf.ts
  rules/types.ts     Rule = { id, page, severity, check(ctx) => Finding | null, fixableByAI }
  scoring/           score calculation + weights
  ai/generate.ts     generate(prompt, schema, opts) — the only OpenAI entry point
  ai/prompts/        one file per task (explain, description, faq, seo, alt, crosssell, imageQuality)
  collectors/        admin.ts (GraphQL), storefront.ts (Playwright), lighthouse.ts
  fixes/             apply/undo per fix type
worker/              BullMQ processors: audit, imageScan, fix
extensions/storerx-theme/   app blocks: faq, trust-badges, crosssells, shipping-bar
prisma/schema.prisma
docs/FEATURES.md
```

## Conventions

- Rule IDs: `page.topic.detail` (e.g. `prod.reviews.fold`). Severity weights high=10 medium=5 low=2.
- Each rule has a unit test with an HTML fixture in `tests/fixtures/<page>/`.
- Findings carry `evidence` (selector, text snippet, or screenshot crop path) — the UI shows it.
- Prompts include store context + brand voice metafield; outputs validated with zod before use.
- Log OpenAI token usage per shop (`AiUsage` table).
- Audit samples pages (home, 3 collections, 5 top products, cart) — never full crawl in the audit job.
- Use `shopify-plugin:shopify-admin` skill for Admin GraphQL, `shopify-plugin:shopify-polaris-app-home` for UI, `shopify-plugin:shopify-liquid` for extension blocks. Validate GraphQL with `validate_graphql_codeblocks` before committing.

## Commands

```
npm run dev            # shopify app dev
npm run worker         # BullMQ workers
npm test               # vitest (rules + scoring)
npx prisma migrate dev
```

## Skills

- `/storerx-audit` — add or modify audit rules, scoring, and AI prompts following the spec.
