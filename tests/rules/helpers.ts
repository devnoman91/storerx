import { readFileSync } from "node:fs";
import { JSDOM, VirtualConsole } from "jsdom";
import { join } from "node:path";
import { UNCHECKED, type Finding, type Rule, type RuleContext, type RuleResult } from "../../app/rules/types";

/**
 * The result of a rule that was expected to check the page. Fails the test if
 * the rule reported it could not — so a passing assertion can never be a
 * rule that silently skipped.
 */
export function checked(result: RuleResult): Finding | null {
  if (result === UNCHECKED) throw new Error("rule reported UNCHECKED, but it should have checked this page");
  return result;
}

export function run(rules: Rule[], id: string, ctx: RuleContext): RuleResult {
  const rule = rules.find((r) => r.id === id);
  if (!rule) throw new Error(`no rule ${id}`);
  return rule.check(ctx);
}

/** A saved storefront page from tests/fixtures/<dir>/<name>.html. */
export function fixture(dir: string, name: string): string {
  return readFileSync(join(__dirname, "..", "fixtures", dir, `${name}.html`), "utf8");
}

/**
 * The same page with elements removed — how a test turns a passing page into
 * a failing one without hand-writing a second copy of a real theme.
 */
export function without(html: string, ...selectors: string[]): string {
  // Parsed with the same parser the rules use, so "removed" means removed.
  const dom = new JSDOM(html, { virtualConsole: new VirtualConsole() });
  for (const selector of selectors) {
    for (const element of dom.window.document.querySelectorAll(selector)) element.remove();
  }
  const out = dom.serialize();
  dom.window.close();
  return out;
}
