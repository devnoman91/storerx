/**
 * Undo fixes
 *
 * Restores the original value from fix.before.
 * Undo is available for 30 days after applying.
 */

import type { Fix, UndoFixOptions } from "./types";

/**
 * Undo a previously applied fix
 */
export async function undoFix(options: UndoFixOptions): Promise<void> {
  const { admin, fix } = options;

  if (fix.status !== "applied") {
    throw new Error(`Cannot undo fix with status: ${fix.status}`);
  }

  // Check if undo is still available (30 days)
  if (fix.appliedAt) {
    const daysSinceApplied = (Date.now() - fix.appliedAt.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceApplied > 30) {
      throw new Error("Undo period has expired (30 days)");
    }
  }

  // Swap before/after and apply
  const undoFix: Fix = {
    ...fix,
    before: fix.after,
    after: fix.before,
  };

  // TODO: Import and use applyFix with swapped values
  // await applyFix({ admin, fix: undoFix });

  throw new Error("Undo not implemented");
}

/**
 * Check if a fix can still be undone
 */
export function canUndo(fix: Fix): boolean {
  if (fix.status !== "applied") return false;
  if (!fix.appliedAt) return false;

  const daysSinceApplied = (Date.now() - fix.appliedAt.getTime()) / (1000 * 60 * 60 * 24);
  return daysSinceApplied <= 30;
}

/**
 * Get remaining days for undo
 */
export function getUndoDaysRemaining(fix: Fix): number | null {
  if (!fix.appliedAt) return null;

  const daysSinceApplied = (Date.now() - fix.appliedAt.getTime()) / (1000 * 60 * 60 * 24);
  const remaining = 30 - daysSinceApplied;

  return remaining > 0 ? Math.ceil(remaining) : 0;
}
