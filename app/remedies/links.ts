/**
 * Deep links into Shopify admin.
 *
 * `shopify://admin/...` is resolved by App Bridge, which navigates the admin
 * around the embedded app rather than opening a new tab or nesting an iframe.
 * Building absolute admin.shopify.com URLs instead would break out of the
 * embedded context and lose the merchant's place.
 */

import type { AdminArea, SettingsPage } from "./types";

/** Settings pages that do not live under /settings. */
const TOP_LEVEL_SETTINGS: Partial<Record<SettingsPage, string>> = {
  apps: "shopify://admin/apps",
};

/**
 * Numeric id from a GID. Admin URLs take the bare id, so
 * `gid://shopify/Product/12345` has to become `12345`.
 */
export function numericId(gid: string | null | undefined): string | null {
  if (!gid) return null;
  if (/^\d+$/.test(gid)) return gid;
  const match = gid.match(/\/(\d+)(?:\?.*)?$/);
  return match?.[1] ?? null;
}

export interface AdminLocation {
  area: AdminArea | null;
  /** Product/collection GID, settings page slug, or theme template name. */
  ref: string | null;
}

/**
 * The admin URL for an issue, or null when there is nowhere specific to send
 * the merchant — a link that lands on the wrong page is worse than no link.
 */
export function adminUrl({ area, ref }: AdminLocation): string | null {
  switch (area) {
    case "product": {
      const id = numericId(ref);
      return id ? `shopify://admin/products/${id}` : null;
    }
    case "collection": {
      const id = numericId(ref);
      return id ? `shopify://admin/collections/${id}` : null;
    }
    case "settings": {
      if (!ref) return null;
      return TOP_LEVEL_SETTINGS[ref as SettingsPage] ?? `shopify://admin/settings/${ref}`;
    }
    case "theme":
      // Opening the editor on the affected template saves the merchant
      // hunting for it; without one, the editor's default view is correct.
      return ref
        ? `shopify://admin/themes/current/editor?template=${encodeURIComponent(ref)}`
        : "shopify://admin/themes/current/editor";
    default:
      return null;
  }
}
