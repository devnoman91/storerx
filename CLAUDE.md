@AGENTS.md

# StoreRx — Claude Code Project Guide
AI Conversion Doctor for Shopify. Audits a store area by area (CRO + performance + SEO + images), scores it, explains what it finds and recommends how to solve it. The merchant makes every change, except drafted copy they approve, which StoreRx applies for them.

**The code is the spec.** There is no separate spec document; the old `docs/FEATURES.md` described a different, broader apply-and-undo product. Before building, read the module that owns the behaviour:

| Question | Source of truth |
|---|---|
| What each scan fetches and which rules it runs | `app/scans/scopes.ts` |
| What a rule checks, and its severity | `app/rules/<page>.ts` |
| Where the merchant solves each problem | `app/remedies/catalog.ts` |
| How scores are computed | `app/scoring/index.ts` |
| Plans, limits, AI allowances | `app/billing/plans.ts` |
| Colours, icons, labels for severity / remedy / area / score | `app/components/tokens.ts` |
| Shared UI building blocks | `app/components/primitives.tsx` |

## Non-negotiable rules

1. **Code finds problems, AI explains and advises.** Every detectable issue is a deterministic rule in `app/rules/<page>.ts`. Never ask the LLM "does this page have reviews?".
2. **StoreRx writes to the store only when the merchant approves one draft.** StoreRx detects, explains and recommends; the merchant makes every change. Where a rule's problem is solved is declared in `app/remedies/catalog.ts` (`admin` / `settings` / `theme` / `messaging`) and the UI turns that into a contextual action. The single exception is copy StoreRx drafted (`Suggestion`) for a field Shopify has — SEO title, meta description, product description, alt text: the merchant may approve a draft and StoreRx writes that one field (`app/suggestions/apply.ts`), with undo. Never write without an approval click, never in bulk, never over a value edited since the draft, and never anything else (theme, settings, prices, products). Write access is an optional scope requested on first use; installs stay read-only. Applying moves the issue to `awaiting_verification` — only a scan resolves. Never label anything "Fix with AI".
3. **No invented numbers.** Impact = High/Medium/Low. Never show "+X% conversion".
4. **All LLM calls use Structured Outputs** via the single wrapper `app/ai/generate.ts`. No free-text parsing. No direct `openai` imports elsewhere.
5. **No LLM calls, PageSpeed requests or storefront fetches inside request handlers.** Everything heavy runs in the worker (`worker/`). The job queue is the `Audit` table itself — workers claim `pending` rows with `FOR UPDATE SKIP LOCKED`. No external broker.
6. **Storefront changes only via Theme App Extension** (`extensions/storerx-theme/`). Never modify merchant theme files.
7. Do not recommend "convert images to WebP" — Shopify CDN handles it.

## Stack

Shopify app template for React Router 7 (`@shopify/shopify-app-react-router`) · TypeScript · Polaris web components (`<s-page>`, `<s-section>`…) · Prisma/PostgreSQL (also the job queue) · jsdom for parsing storefront HTML · Google PageSpeed Insights API for performance · OpenAI SDK · zod · Theme App Extension · vitest.

No headless browser, local Lighthouse or image processing: storefront pages are fetched as HTML, speed comes from PageSpeed Insights, and catalog images are judged from Admin API metadata (dimensions, size, alt) without downloading them.

## Layout

```
app/
  routes/            React Router routes (embedded admin UI) + webhooks
  rules/             one file per page type: homepage collection product cart checkout images perf
  rules/types.ts     Rule = { id, page, severity, check(ctx) => Finding | UNCHECKED | null }
  rules/page.ts      pageFor(html) — the parsed page every page rule reads
  scans/             scan scopes, the steps a scan walks, coverage
  remedies/          where each rule's problem is solved + the actions offered
  suggestions/       drafted copy queue (per item, on request) + applying an approved draft
  issues/            issue identity, reconciliation across scans, persistence
  scoring/           score calculation + weights
  billing/           plans, allowances, Shopify Billing API
  ai/generate.ts     generate(prompt, schema, opts) — the only OpenAI entry point
  ai/prompts/        one file per task: explain, description, faq, seo, alt
  collectors/        admin.ts (GraphQL), storefront.ts (fetch), lighthouse.ts (PageSpeed Insights), images.ts (catalog media)
  components/        tokens, primitives, issue cards, recommendation panels
  queue.server.ts    audit queue: claim, heartbeat, reap
worker/              poll-loop processors: index (loop), audit, suggestions
extensions/storerx-theme/   app blocks: faq, trust-badges, cross-sells, shipping-bar
prisma/schema.prisma
tests/               mirrors app/; fixtures in tests/fixtures/
```

## Conventions

- Rule IDs: `page.topic.detail` (e.g. `prod.reviews.fold`). Severity weights high=10 medium=5 low=2.
- Page rules read the parsed page through `pageFor(ctx.html)` (`app/rules/page.ts`) — never regex over raw HTML, which matches words in scripts, CSS and meta tags. Static HTML has no layout, so no rule may claim "above the fold" or "on mobile"; use structure ("in the section with the add-to-cart form").
- A rule returns `null` only when it checked and passed. When the page lacks what it needs (an empty cart, an unknown product) it returns `UNCHECKED` — otherwise the scan would count it as checked and resolve open issues it never looked at.
- Each rule is tested against the real Dawn pages in `tests/fixtures/dawn/`; build failing cases with `without()` from `tests/rules/helpers.ts`.
- Findings carry `evidence` (selector or text snippet) — the UI shows it.
- Prompts include store context + brand voice; outputs validated with zod before use.
- Log OpenAI token usage per shop (`AiUsage` table).
- Scans sample pages (home, 3 collections, 5 products, cart) — never a full crawl. Catalog image checks cover every product through Admin API metadata instead.
- Every rule ID must have an entry in `app/remedies/catalog.ts`; `tests/remedies` fails otherwise.
- Issue lifecycle: `open` → `awaiting_verification` (merchant says they did it) → `resolved` (a scan confirmed it). Only a scan may resolve an issue.
- UI colour, icon and label choices come from `app/components/tokens.ts`; don't invent new ones per screen.
- Use `shopify-plugin:shopify-admin` skill for Admin GraphQL, `shopify-plugin:shopify-polaris-app-home` for UI, `shopify-plugin:shopify-liquid` for extension blocks. Validate GraphQL with `validate_graphql_codeblocks` before committing.

## Commands

```
npm run dev            # shopify app dev
npm run worker         # audit worker (polls the Audit table)
npm test               # vitest
npm run typecheck
npx prisma migrate dev
```

## Skills

- `/storerx-audit` (`.claude/skills/storerx-audit/`) — add or modify audit rules, scoring, drafted copy and AI prompts.
