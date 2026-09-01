---
name: storerx-audit
description: Add, modify, or review StoreRx audit rules, scoring, image checks, performance checks, and AI prompts/fixes. Use when the user asks to add a check, change a score, add a "Fix with AI" type, or write a prompt for the audit.
---

# StoreRx Audit Skill

Source of truth: `docs/FEATURES.md` sections 3–8. Read the relevant section before changing anything.

## Adding a rule

1. Pick the page file `app/rules/<page>.ts` and an ID `page.topic.detail`.
2. Implement:
   ```ts
   export const rule: Rule = {
     id: 'prod.reviews.fold',
     page: 'product',
     severity: 'high',
     fixableByAI: false,
     title: 'No reviews above the fold',
     check(ctx) {
       // ctx.html (cheerio), ctx.mobileScreenshot, ctx.admin (typed data), ctx.lighthouse
       const found = ctx.aboveFold('[class*="review"], [data-reviews], .jdgm-widget');
       return found ? null : { evidence: 'No review widget in first 800px (mobile)' };
     },
   };
   ```
3. Register in `app/rules/index.ts`.
4. Add fixture `tests/fixtures/<page>/<case>.html` and a vitest case for pass + fail.
5. Add the row to the table in `docs/FEATURES.md` §4/§5/§6.
6. Deterministic only. If the check needs judgement (layout clutter, image quality), it belongs in `ai/prompts/` with a JSON schema and is flagged `source: 'ai'` and severity ≤ medium.

## Changing scores

Weights live in `app/scoring/weights.ts`. Score = 100 − Σ(weight × count), floor 0, per category. Update §3 of the spec if weights change. Overall = weighted mean (Conversion 30, Product Pages 25, Performance 20, UX 15, SEO 10).

## Adding a "Fix with AI" type

1. Prompt file `app/ai/prompts/<name>.ts` exporting `{ system, build(ctx), schema (zod) }`.
2. Call only via `generate()`; never import `openai` directly.
3. Fix handler `app/fixes/<name>.ts` with `apply(fix)` and `undo(fix)`; both use Admin GraphQL validated with the Shopify skill.
4. `before` snapshot is mandatory. Status flow: `preview → approved → applied | discarded`, `applied → undone`.
5. Gate by plan in `app/billing/limits.ts`. Add to §8 table in the spec.

## Prompt guidelines

- System prompt states: ecommerce copywriter, output JSON only, respect brand voice, no fabricated claims (no invented reviews, awards, materials, certifications).
- Always include: product title, current copy, variants, tags, brand voice sample, target length.
- Length limits in schema: SEO title ≤ 60 chars, meta ≤ 160, alt ≤ 125, description 120–250 words.
- Vision prompts: send 1 image per call, max 1024px, `detail: 'low'` unless quality judgement needs more.
- Models: `gpt-4.1-mini` default; `gpt-4.1` only for product descriptions and layout judgement.

## Checklist before finishing

- [ ] Rule is deterministic and has pass/fail fixture tests
- [ ] Evidence string is human-readable and specific
- [ ] Spec tables updated
- [ ] No OpenAI/Playwright/Lighthouse call in a route loader/action
- [ ] GraphQL validated
