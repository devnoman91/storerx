/**
 * A drafted FAQ, stored in Suggestion.suggested.
 *
 * Every other draft is one field the merchant pastes whole. A FAQ is pasted
 * one entry at a time — each question and answer into its own collapsible
 * block in the theme — so it is kept structured, and read back with a fallback so a
 * malformed row shows as text rather than breaking the page.
 */

export interface FaqEntry {
  question: string;
  answer: string;
}

export function serializeFaq(entries: FaqEntry[]): string {
  return JSON.stringify({ questions: entries });
}

export function parseFaq(suggested: string): FaqEntry[] | null {
  try {
    const parsed = JSON.parse(suggested) as { questions?: unknown };
    if (!Array.isArray(parsed.questions)) return null;
    const entries = parsed.questions.filter(
      (entry): entry is FaqEntry =>
        typeof entry?.question === "string" && typeof entry?.answer === "string",
    );
    return entries.length > 0 ? entries : null;
  } catch {
    return null;
  }
}
