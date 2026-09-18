# Dawn fixtures

Pages from Shopify's own Dawn demo store (https://theme-dawn-demo.myshopify.com),
fetched 2026-09-18. Dawn is Shopify's reference theme, MIT licensed, and the
theme most stores are built from — so rules are tested against real markup
rather than hand-written HTML that only contains what the rule looks for.

| File | Page |
|---|---|
| `home.html` | `/` |
| `collection.html` | `/collections/bags` (16 products) |
| `product.html` | `/products/small-convertible-flex-bag-cappuccino` |
| `cart.html` | `/cart`, empty — a fresh session has nothing in it |

Inline `<style>` and `<script>` bodies are emptied to keep the files small.
Rules remove those elements before reading a page anyway; every
`<script src>` (how installed apps show up) and every JSON-LD block is kept.

To test a failing case, remove elements with `without()` in
`tests/rules/helpers.ts` rather than editing these files.
