/**
 * Homepage rules
 *
 * Each rule reads the parsed page (./page.ts), never the raw HTML, so a word
 * in a script or a meta tag cannot pass or fail a check. Static HTML carries
 * no layout, so "above the fold" is expressed as "in the first section of the
 * page" — the part a visitor meets first on every theme.
 */

import { pageFor } from "./page";
import type { Rule, RuleContext, RuleResult } from "./types";

/** Visible wording that promises something about shipping or delivery. */
const SHIPPING_PROMISE = /free (shipping|delivery|returns?)|ships? (in|within|today|same)|next[- ]day|delivery/i;

/** Readable signals of social proof or reassurance. */
const TRUST_TEXT =
  /\breviews?\b|testimonials?|\brated\b|★|trustpilot|as seen (in|on)|featured in|guarantee|money[- ]back|secure checkout|happy customers|satisfied customers/i;

/** Class or id fragments review and trust widgets render with. */
const TRUST_WIDGET =
  '[class*="review" i], [class*="testimonial" i], [class*="rating" i], [class*="jdgm"], [class*="yotpo"], [class*="okendo" i], [class*="loox"], [class*="stamped"], [class*="trustpilot" i], [class*="trust-badge" i]';

/**
 * Popup and email-capture tools, by the host or path of the script they load.
 * Named, rather than inferred from words like "modal" — every theme has modals
 * for search and the cart, which are not popups.
 */
const POPUP_TOOLS: Array<[RegExp, string]> = [
  [/klaviyo\.com\/onsite/i, "Klaviyo"],
  [/privy\.com/i, "Privy"],
  [/justuno\.com|justone\.ai/i, "Justuno"],
  [/omappapi\.com|optinmonster/i, "OptinMonster"],
  [/wisepops\.com/i, "Wisepops"],
  [/omnisnippet|omnisend/i, "Omnisend"],
  [/sumo\.com/i, "Sumo"],
  [/poptin\.com/i, "Poptin"],
  [/sleeknote\.com/i, "Sleeknote"],
  [/getsitecontrol\.com/i, "Getsitecontrol"],
  [/hellobar\.com/i, "Hello Bar"],
  [/wheelio/i, "Wheelio"],
  [/popupsmart\.com/i, "Popupsmart"],
  [/chimpstatic\.com/i, "Mailchimp"],
];

/** Footer link categories shoppers look for before trusting a store. */
const FOOTER_LINKS: Array<[string, RegExp]> = [
  ["contact", /contact/i],
  ["about", /about|our story/i],
  ["policies", /polic|privacy|refund|returns?|terms|shipping/i],
];

export const homepageRules: Rule[] = [
  {
    id: "home.hero.cta",
    page: "homepage",
    severity: "high",
    description: "The first section of the homepage has a call to action",
    check: (ctx: RuleContext): RuleResult => {
      const page = pageFor(ctx.html);
      const first = page.firstSection;
      if (!first) return null;

      const actions = page
        .all("a[href], button", first)
        .filter((element) => page.text(element).length > 1);
      if (actions.length > 0) return null;

      return {
        ruleId: "home.hero.cta",
        page: "homepage",
        severity: "high",
        title: "Your homepage's first section has no call to action",
        evidence: {
          type: "text",
          value: `The first section${first.id ? ` (${first.id})` : ""} has no link or button, so visitors arriving on the homepage aren't pointed anywhere`,
        },
      };
    },
  },

  {
    id: "home.announcement",
    page: "homepage",
    severity: "medium",
    description: "An announcement bar or a shipping promise at the top of the page",
    check: (ctx: RuleContext): RuleResult => {
      const page = pageFor(ctx.html);

      const bar = page
        .all('[class*="announcement" i], [id*="announcement" i]')
        .some((element) => page.text(element).length > 0);
      if (bar) return null;

      // A shipping promise in the header counts even without a dedicated bar.
      if (SHIPPING_PROMISE.test(page.text(page.header))) return null;

      return {
        ruleId: "home.announcement",
        page: "homepage",
        severity: "medium",
        title: "No announcement bar or shipping promise at the top of the page",
        evidence: {
          type: "text",
          value: "No announcement bar was found, and the header doesn't mention shipping or delivery",
        },
      };
    },
  },

  {
    id: "home.featured",
    page: "homepage",
    severity: "medium",
    description: "The homepage features products or collections",
    check: (ctx: RuleContext): RuleResult => {
      const page = pageFor(ctx.html);
      const products = page.productCards().length;
      const collections = page.all('a[href*="/collections/"]', page.main).length;
      if (products > 0 || collections > 0) return null;

      return {
        ruleId: "home.featured",
        page: "homepage",
        severity: "medium",
        title: "Your homepage doesn't feature any products or collections",
        evidence: {
          type: "text",
          value: "The homepage content has no links to a product or a collection",
        },
      };
    },
  },

  {
    id: "home.trust",
    page: "homepage",
    severity: "high",
    description: "Reviews, testimonials, guarantees or other social proof",
    check: (ctx: RuleContext): RuleResult => {
      const page = pageFor(ctx.html);
      if (page.has(TRUST_WIDGET, page.main)) return null;
      if (TRUST_TEXT.test(page.text(page.main))) return null;

      return {
        ruleId: "home.trust",
        page: "homepage",
        severity: "high",
        title: "Your homepage shows no reviews or other social proof",
        evidence: {
          type: "text",
          value:
            "No reviews, testimonials, ratings or guarantees were found in the homepage content. " +
            "Review widgets that only load after the page opens can't be seen here.",
        },
      };
    },
  },

  {
    id: "home.popups",
    page: "homepage",
    severity: "medium",
    description: "More than one popup or email-capture tool loads on the homepage",
    check: (ctx: RuleContext): RuleResult => {
      const page = pageFor(ctx.html);
      const tools = new Set<string>();
      for (const src of page.scriptSources) {
        for (const [pattern, name] of POPUP_TOOLS) if (pattern.test(src)) tools.add(name);
      }
      if (tools.size < 2) return null;

      const names = [...tools].sort();
      return {
        ruleId: "home.popups",
        page: "homepage",
        severity: "medium",
        title: `${names.length} popup and email-capture tools load on your homepage`,
        evidence: {
          type: "text",
          value: `${names.join(", ")}. Each can show its own popup, so a first-time visitor may be interrupted more than once.`,
        },
      };
    },
  },

  {
    id: "home.nav",
    page: "homepage",
    severity: "low",
    description: "Search is available from the header",
    check: (ctx: RuleContext): RuleResult => {
      const page = pageFor(ctx.html);
      const scope = page.header ?? page.doc.body;
      if (!scope) return null;

      const search = page.has(
        'form[action*="/search"], a[href*="/search"], input[type="search"], predictive-search, [class*="search" i]',
        scope,
      );
      if (search) return null;

      return {
        ruleId: "home.nav",
        page: "homepage",
        severity: "low",
        title: "There's no search in your header",
        evidence: {
          type: "text",
          value: "No search form, search link or search field was found in the header",
        },
      };
    },
  },

  {
    id: "home.contact",
    page: "homepage",
    severity: "medium",
    description: "Contact, About and policy links in the footer",
    check: (ctx: RuleContext): RuleResult => {
      const page = pageFor(ctx.html);
      const footer = page.footer;
      if (!footer) return null;

      const links = page
        .all("a[href]", footer)
        .map((link) => `${link.getAttribute("href")} ${page.text(link)}`);
      const missing = FOOTER_LINKS.filter(([, pattern]) => !links.some((link) => pattern.test(link)));

      // Two of the three is enough; a store with contact and policies but no
      // About page is not hiding anything.
      if (missing.length <= 1) return null;

      return {
        ruleId: "home.contact",
        page: "homepage",
        severity: "medium",
        title: "Your footer is missing essential links",
        evidence: {
          type: "text",
          value: `No ${missing.map(([name]) => name).join(" or ")} links in the footer`,
        },
      };
    },
  },
];

export default homepageRules;
