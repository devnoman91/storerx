/**
 * The actions offered for an issue.
 *
 * Deliberately not one generic button: what a merchant can do about a missing
 * meta description is nothing like what they can do about a weak value
 * proposition, and the UI should say so before they click. Labels never
 * promise that StoreRx will change the store.
 */

import { adminUrl } from "./links";
import type { AdminArea, RemedyKind, SuggestionKind } from "./types";

export type IssueStatus = "open" | "awaiting_verification" | "resolved";

export const SUGGESTION_LABELS: Record<
  SuggestionKind,
  { noun: string; view: string; draft: string; redraft: string; heading: string }
> = {
  alt_text: {
    noun: "alt text",
    view: "View suggested alt text",
    draft: "Draft alt text",
    redraft: "Draft another",
    heading: "Suggested alt text",
  },
  seo_title: {
    noun: "SEO title",
    view: "View suggested SEO title",
    draft: "Draft SEO title",
    redraft: "Draft another",
    heading: "Suggested SEO title",
  },
  seo_meta: {
    noun: "meta description",
    view: "View suggested meta description",
    draft: "Draft meta description",
    redraft: "Draft another",
    heading: "Suggested meta description",
  },
  product_description: {
    noun: "description",
    view: "View suggested description",
    draft: "Draft description",
    redraft: "Draft another",
    heading: "Suggested description",
  },
};

const SETTINGS_LABELS: Record<string, string> = {
  checkout: "Open checkout settings",
  payments: "Open payment settings",
  shipping: "Open shipping settings",
  apps: "Review installed apps",
};

/** One-line statement of who makes the change, shown on the detail page. */
export const OWNERSHIP: Record<RemedyKind, string> = {
  admin: "You make this change in Shopify admin. StoreRx never edits your store.",
  settings: "You change this in your Shopify settings. StoreRx never edits your store.",
  theme: "You make this change in your theme editor. StoreRx never edits your storefront.",
  messaging: "This is a copy and positioning change for you to make. StoreRx never edits your storefront.",
};

/** Short label for the kind of work, used on cards and filters. */
export const REMEDY_LABELS: Record<RemedyKind, string> = {
  admin: "Shopify admin",
  settings: "Shopify settings",
  theme: "Theme",
  messaging: "Messaging",
};

export interface IssueAction {
  label: string;
  /** Set for actions that leave StoreRx. */
  href?: string;
  /** Why the action cannot be taken yet, when it is unavailable. */
  unavailable?: string;
}

export interface IssueActions {
  /** Always opens the issue in StoreRx. */
  primary: IssueAction;
  /** Where the merchant goes to act, or what they will find inside. */
  secondary: IssueAction | null;
}

export interface ActionContext {
  remedy: RemedyKind;
  status: IssueStatus;
  suggestion?: SuggestionKind | null;
  adminArea?: AdminArea | null;
  adminRef?: string | null;
}

export function actionsFor(context: ActionContext): IssueActions {
  if (context.status === "resolved") {
    return { primary: { label: "View recommendation" }, secondary: null };
  }

  const primary: IssueAction = {
    label: context.suggestion ? SUGGESTION_LABELS[context.suggestion].view : "View recommendation",
  };

  const href = adminUrl({ area: context.adminArea ?? null, ref: context.adminRef ?? null });

  switch (context.remedy) {
    case "admin":
      return {
        primary,
        secondary: href
          ? { label: "Edit in Shopify Admin", href }
          : {
              label: "Edit in Shopify Admin",
              unavailable: "StoreRx could not tell which product this belongs to. Re-scan this area to link it.",
            },
      };
    case "settings":
      return {
        primary,
        secondary: href
          ? { label: SETTINGS_LABELS[context.adminRef ?? ""] ?? "Open Shopify settings", href }
          : null,
      };
    case "theme":
      return { primary, secondary: { label: "How to improve" } };
    case "messaging":
      return { primary, secondary: { label: "See suggested approach" } };
  }
}

/** Status shown on a card or detail header. */
export const STATUS_BADGE: Record<
  IssueStatus,
  { label: string; tone: "info" | "warning" | "success" | "neutral" }
> = {
  open: { label: "Open", tone: "neutral" },
  awaiting_verification: { label: "Awaiting verification", tone: "info" },
  resolved: { label: "Verified", tone: "success" },
};
