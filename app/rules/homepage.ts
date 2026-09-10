/**
 * Homepage rules
 */

import type { Rule, RuleContext, Finding } from "./types";

function hasElement(html: string, patterns: string[]): boolean {
  return patterns.some((p) => new RegExp(p, "i").test(html));
}

function isAboveFold(html: string, patterns: string[]): boolean {
  for (const p of patterns) {
    const match = html.match(new RegExp(p, "i"));
    if (match && match.index! < html.length * 0.25) return true;
  }
  return false;
}

export const homepageRules: Rule[] = [
  {
    id: "home.hero.cta",
    page: "homepage",
    severity: "high",
    description: "Hero headline + CTA visible above fold on mobile",
    fixableByAI: false,
    check: (ctx: RuleContext): Finding | null => {
      const heroPatterns = ["hero", "banner", "slideshow", "carousel"];
      const ctaPatterns = ["shop.*now", "buy.*now", "get.*started", "explore", "cta", "button.*primary"];

      const hasHero = hasElement(ctx.html, heroPatterns);
      const hasCta = isAboveFold(ctx.html, ctaPatterns);

      if (!hasHero || !hasCta) {
        return {
          ruleId: "home.hero.cta",
          page: "homepage",
          severity: "high",
          title: "Hero section missing clear CTA above the fold",
          evidence: { type: "text", value: "Visitors need immediate direction to act" },
          fixableByAI: false,
        };
      }
      return null;
    },
  },

  {
    id: "home.announcement",
    page: "homepage",
    severity: "medium",
    description: "Announcement bar / shipping promise present",
    fixableByAI: false,
    check: (ctx: RuleContext): Finding | null => {
      const announcementPatterns = [
        "announcement",
        "promo-bar",
        "free.*shipping",
        "shipping.*free",
        "delivery",
      ];

      if (!hasElement(ctx.html, announcementPatterns)) {
        return {
          ruleId: "home.announcement",
          page: "homepage",
          severity: "medium",
          title: "No announcement bar or shipping promise",
          evidence: { type: "text", value: "Shipping info reduces cart abandonment" },
          fixableByAI: false,
        };
      }
      return null;
    },
  },

  {
    id: "home.featured",
    page: "homepage",
    severity: "medium",
    description: "Featured collections or products in first 2 screens",
    fixableByAI: false,
    check: (ctx: RuleContext): Finding | null => {
      const featuredPatterns = [
        "featured.*product",
        "featured.*collection",
        "best.*seller",
        "new.*arrival",
        "trending",
        "popular",
        "collection-list",
        "product-grid",
      ];

      if (!hasElement(ctx.html, featuredPatterns)) {
        return {
          ruleId: "home.featured",
          page: "homepage",
          severity: "medium",
          title: "No featured products or collections visible early",
          evidence: { type: "text", value: "Showcase your best products immediately" },
          fixableByAI: false,
        };
      }
      return null;
    },
  },

  {
    id: "home.trust",
    page: "homepage",
    severity: "high",
    description: "Trust elements (reviews, badges, press, guarantees)",
    fixableByAI: false,
    check: (ctx: RuleContext): Finding | null => {
      const trustPatterns = [
        "testimonial",
        "review",
        "as.*seen.*in",
        "featured.*in",
        "trust",
        "guarantee",
        "secure",
        "verified",
        "press",
        "badge",
      ];

      if (!hasElement(ctx.html, trustPatterns)) {
        return {
          ruleId: "home.trust",
          page: "homepage",
          severity: "high",
          title: "Homepage lacks trust elements",
          evidence: { type: "text", value: "Reviews, badges, or social proof build credibility" },
          fixableByAI: false,
        };
      }
      return null;
    },
  },

  {
    id: "home.popups",
    page: "homepage",
    severity: "medium",
    description: "More than 1 popup on load",
    fixableByAI: false,
    check: (ctx: RuleContext): Finding | null => {
      const popupPatterns = [
        "popup",
        "modal",
        "overlay",
        "newsletter.*signup",
        "email.*capture",
        "spin.*wheel",
        "exit.*intent",
      ];

      let popupCount = 0;
      for (const p of popupPatterns) {
        const matches = ctx.html.match(new RegExp(p, "gi"));
        if (matches) popupCount += matches.length;
      }

      // Heuristic: if many popup references, likely aggressive
      if (popupCount > 3) {
        return {
          ruleId: "home.popups",
          page: "homepage",
          severity: "medium",
          title: "Multiple popups detected on homepage",
          evidence: { type: "text", value: "Too many popups hurt user experience" },
          fixableByAI: false,
        };
      }
      return null;
    },
  },

  {
    id: "home.nav",
    page: "homepage",
    severity: "low",
    description: "Main nav ≤ 7 items, has Search",
    fixableByAI: false,
    check: (ctx: RuleContext): Finding | null => {
      const hasSearch = hasElement(ctx.html, ["search", "icon.*search", "search.*icon"]);

      if (!hasSearch) {
        return {
          ruleId: "home.nav",
          page: "homepage",
          severity: "low",
          title: "Navigation missing search functionality",
          evidence: { type: "text", value: "Search helps visitors find products quickly" },
          fixableByAI: false,
        };
      }
      return null;
    },
  },

  {
    id: "home.contact",
    page: "homepage",
    severity: "medium",
    description: "Contact / About / Policies links in footer",
    fixableByAI: false,
    check: (ctx: RuleContext): Finding | null => {
      const footerPatterns = ["contact", "about", "privacy", "terms", "policy", "refund", "return"];

      // Check footer area (last portion of HTML)
      const footerHtml = ctx.html.slice(-Math.floor(ctx.html.length * 0.2));
      const hasFooterLinks = footerPatterns.filter((p) =>
        new RegExp(p, "i").test(footerHtml)
      ).length;

      if (hasFooterLinks < 2) {
        return {
          ruleId: "home.contact",
          page: "homepage",
          severity: "medium",
          title: "Footer missing essential links",
          evidence: { type: "text", value: "Contact, About, and Policies build trust" },
          fixableByAI: false,
        };
      }
      return null;
    },
  },
];

export default homepageRules;
