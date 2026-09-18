---
name: storerx-audit
description: Add, modify, or review StoreRx audit rules, scoring, image checks, performance checks, and AI prompts/fixes. Use when the user asks to add a check, change a score, add a "Fix with AI" type, or write a prompt for the audit.
---

# StoreRx Audit Skill

Source of truth: `docs/FEATURES.md` sections 3–8. Read the relevant section before changing anything.

## Adding a rule

1. Pick the page file `app/rules/<page>.ts` and an ID `page.topic.detail`.
2. Implement it against the parsed page, never the raw HTML:
   ```ts
   {
     id: 'prod.reviews.fold',
     page: 'product',
     severity: 'high',
     description: 'Reviews or a rating shown near the buy button',
     check: (ctx) => {
       const page = pageFor(ctx.html);          // parsed once, scripts/styles stripped
       const buyArea = page.buyArea;            // section holding the add-to-cart form
       if (!buyArea) return UNCHECKED;          // nothing to judge — NOT a pass
       if (page.has('[class*="jdgm"]', buyArea)) return null;   // checked, passed
       return { ruleId: 'prod.reviews.fold', page: 'product', severity: 'high',
                title: "Reviews aren't shown near the buy button",
                evidence: { type: 'text', value: 'What was actually seen' } };
     },
   }
   ```
   - `null` = checked and passed. `UNCHECKED` = could not check. Mixing them up resolves issues nobody looked at.
   - No "above the fold" / "on mobile" claims — static HTML has no layout.
   - Rules about the product itself read its Admin data via `ctx.resourceId`.
3. Register in `app/rules/index.ts`, and add its remedy to `app/remedies/catalog.ts`.
4. Test against `tests/fixtures/dawn/` — a passing Dawn page, a failing one built with `without()`, and the `UNCHECKED` case.
5. Add the row to the table in `docs/FEATURES.md` §4/§5/§6.
6. Deterministic only. If the check needs judgement (layout clutter, image quality), it belongs in `ai/prompts/` with a JSON schema and is flagged `source: 'ai'` and severity ≤ medium.

## Changing scores

Weights live in `app/scoring/index.ts` (`SEVERITY_WEIGHTS` in `app/rules/types.ts`, category weights
in `CATEGORY_WEIGHTS`). Score = 100 − Σ(weight × count) per category, floor 0, counting each rule
once however many pages or images it hit (`collapseByRule`). Overall = weighted mean over
*measured* categories only. Update §3 of the spec if weights change.

## Adding drafted copy (a `SuggestionKind`)

StoreRx never applies a change. It can *draft* copy for a merchant to review and paste in
themselves, and only for fields Shopify actually exposes.

1. Prompt file `app/ai/prompts/<name>.ts`; call only via `generate()`, never import `openai` directly.
2. Add the kind to `SuggestionKind` in `app/remedies/types.ts` and a label set in
   `app/remedies/actions.ts` (`SUGGESTION_LABELS`).
3. Point the rule at it in `app/remedies/catalog.ts` — `suggestion` is only valid on `kind: "admin"`.
4. Handle it in `worker/suggestions.ts`: read the current value from Admin GraphQL, generate,
   store `current` + `suggested`. Never write back.
5. Drafts cost one AI credit and are checked against `aiCreditsRemaining` before generating.

## Adding a rule's remedy

Every rule ID needs an entry in `app/remedies/catalog.ts` saying where the merchant solves it:
`admin` (a Shopify field), `settings` (a Shopify setting), `theme` (theme editor) or `messaging`
(copy judgement). `tests/remedies` fails the build if one is missing or points nowhere.

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
- [ ] Rule has a remedy in `app/remedies/catalog.ts`
- [ ] No UI copy promises StoreRx will change the store
- [ ] GraphQL validated
