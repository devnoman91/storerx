/**
 * Fix types for StoreRx
 *
 * Every fix follows: preview → approve → apply → undo available
 * AI never writes to the store without merchant approval.
 */

import type { FixType } from "../rules/types";

export type FixStatus = "preview" | "applied" | "undone";

export interface Fix {
  id: string;
  shopDomain: string;
  type: FixType;
  /** Target resource ID (product ID, image ID, etc.) */
  targetId: string;
  /** Target resource title for display */
  targetTitle: string;
  /** Original value before fix */
  before: string;
  /** New value after fix */
  after: string;
  /** Current status */
  status: FixStatus;
  /** When the fix was created */
  createdAt: Date;
  /** When the fix was applied (if applied) */
  appliedAt?: Date;
  /** When the fix was undone (if undone) */
  undoneAt?: Date;
  /** AI generation count for this fix */
  generationCount: number;
}

export interface ApplyFixOptions {
  /** Shopify Admin GraphQL client */
  admin: {
    graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
  };
  /** The fix to apply */
  fix: Fix;
}

export interface UndoFixOptions {
  /** Shopify Admin GraphQL client */
  admin: {
    graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
  };
  /** The fix to undo */
  fix: Fix;
}
