/**
 * Draft processor — runs inside the audit worker.
 *
 * Writes nothing to the store. Each job reads the current value from the
 * Admin API, asks the LLM for a better one, and saves both so the merchant
 * can compare them and paste the new one in themselves.
 */

import prisma from "../app/db.server";
import { unauthenticated } from "../app/shopify.server";
import { logUsage } from "../app/ai/generate";
import { generateAltText, generateDescription, generateSeo } from "../app/ai/prompts";
import { aiCreditsRemaining } from "../app/billing/billing.server";
import { NonRetryableError } from "../app/errors";
import type { SuggestionKind } from "../app/remedies/types";
import {
  claimNextSuggestion,
  completeDraft,
  failDraft,
  type ClaimedSuggestion,
} from "../app/suggestions/queue.server";

interface AdminApiClient {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
}

/**
 * Width to request from Shopify's CDN before sending an image to the vision
 * model. Full-size originals can be many megabytes; 1024px is the most the
 * model uses and keeps the request small.
 */
const VISION_IMAGE_WIDTH = 1024;

/** Hard ceiling on a downloaded image, in case the CDN ignores the resize. */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const PRODUCT_QUERY = `#graphql
  query DraftProductContext($id: ID!) {
    product(id: $id) {
      id
      title
      vendor
      productType
      tags
      descriptionHtml
      seo {
        title
        description
      }
      variants(first: 10) {
        nodes {
          title
          price
        }
      }
    }
  }
`;

const MEDIA_QUERY = `#graphql
  query DraftMediaContext($id: ID!) {
    node(id: $id) {
      ... on MediaImage {
        id
        alt
        image {
          url
        }
      }
    }
  }
`;

interface ProductContextNode {
  id: string;
  title: string;
  vendor: string | null;
  productType: string | null;
  tags: string[];
  descriptionHtml: string | null;
  seo: { title: string | null; description: string | null } | null;
  variants: { nodes: Array<{ title: string; price: string }> };
}

async function loadProduct(admin: AdminApiClient, id: string): Promise<ProductContextNode> {
  const response = await admin.graphql(PRODUCT_QUERY, { variables: { id } });
  const body = (await response.json()) as { data?: { product?: ProductContextNode | null } };
  const product = body.data?.product;
  if (!product) {
    throw new NonRetryableError("That product no longer exists in your store.");
  }
  return product;
}

/** Fetch a CDN image as base64, resized so the vision call stays small. */
async function fetchImage(url: string): Promise<string> {
  const sized = new URL(url);
  sized.searchParams.set("width", String(VISION_IMAGE_WIDTH));

  const response = await fetch(sized.toString());
  if (!response.ok) {
    throw new Error(`Could not download the image (${response.status})`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > MAX_IMAGE_BYTES) {
    throw new NonRetryableError("That image is too large for StoreRx to read.");
  }
  const mime = response.headers.get("content-type") || "image/jpeg";
  return `data:${mime};base64,${buffer.toString("base64")}`;
}

function stripHtml(html: string | null | undefined): string {
  return (html ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

export interface DraftResult {
  current: string | null;
  suggested: string;
  model: string;
  usage: { promptTokens: number; completionTokens: number };
}

async function draftAltText(
  admin: AdminApiClient,
  claimed: ClaimedSuggestion,
  productTitle: string | null,
): Promise<DraftResult> {
  const response = await admin.graphql(MEDIA_QUERY, { variables: { id: claimed.targetId } });
  const body = (await response.json()) as {
    data?: { node?: { alt: string | null; image: { url: string } | null } | null };
  };
  const media = body.data?.node;
  if (!media?.image?.url) {
    throw new NonRetryableError("That image is no longer in your store.");
  }

  const result = await generateAltText(
    await fetchImage(media.image.url),
    productTitle ?? "this product",
  );
  return {
    current: media.alt,
    suggested: result.data.altText,
    model: "gpt-4.1-mini",
    usage: result.usage,
  };
}

async function draftSeo(
  admin: AdminApiClient,
  claimed: ClaimedSuggestion,
  shopName: string,
  field: "seo_title" | "seo_meta",
): Promise<DraftResult> {
  const product = await loadProduct(admin, claimed.targetId);
  const result = await generateSeo({
    productTitle: product.title,
    productType: product.productType ?? undefined,
    vendor: product.vendor ?? undefined,
    storeName: shopName,
    currentTitle: product.seo?.title ?? undefined,
    currentMeta: product.seo?.description ?? undefined,
  });

  return {
    current: field === "seo_title" ? product.seo?.title ?? null : product.seo?.description ?? null,
    suggested: field === "seo_title" ? result.data.title : result.data.metaDescription,
    model: "gpt-4.1-mini",
    usage: result.usage,
  };
}

async function draftDescription(
  admin: AdminApiClient,
  claimed: ClaimedSuggestion,
  brandVoice: string | null,
): Promise<DraftResult> {
  const product = await loadProduct(admin, claimed.targetId);
  const result = await generateDescription(
    {
      title: product.title,
      currentDescription: stripHtml(product.descriptionHtml) || undefined,
      variants: product.variants.nodes,
      tags: product.tags,
      vendor: product.vendor ?? undefined,
      productType: product.productType ?? undefined,
    },
    brandVoice ?? undefined,
  );

  return {
    current: product.descriptionHtml,
    suggested: result.data.description,
    model: "gpt-4.1",
    usage: result.usage,
  };
}

async function runDraft(claimed: ClaimedSuggestion): Promise<void> {
  const shop = await prisma.shop.findUnique({ where: { id: claimed.shopId } });
  if (!shop) throw new NonRetryableError("This store is no longer connected to StoreRx.");

  // Checked again here, not just when the merchant asked: several drafts can
  // be queued before any of them runs.
  if ((await aiCreditsRemaining(shop)) === 0) {
    throw new NonRetryableError(
      "You've used all your AI credits this month. They reset at the start of your next period, " +
        "or you can upgrade for more.",
    );
  }

  const suggestion = await prisma.suggestion.findUnique({
    where: { id: claimed.id },
    select: { targetTitle: true },
  });

  const { admin } = await unauthenticated.admin(shop.domain);
  const kind = claimed.kind as SuggestionKind;

  let result: DraftResult;
  switch (kind) {
    case "alt_text":
      result = await draftAltText(admin, claimed, suggestion?.targetTitle ?? null);
      break;
    case "seo_title":
    case "seo_meta":
      result = await draftSeo(admin, claimed, shop.name || shop.domain, kind);
      break;
    case "product_description":
      result = await draftDescription(admin, claimed, shop.brandVoice);
      break;
    default:
      throw new NonRetryableError(`StoreRx cannot draft "${claimed.kind}".`);
  }

  await completeDraft(claimed.id, { current: result.current, suggested: result.suggested });
  await logUsage(shop.domain, kind, result.model, result.usage, 1);
}

/**
 * Drain the draft queue. Returns whether any job ran, so the worker's poll
 * loop can keep going while there is work.
 */
export async function drainSuggestions(shouldStop: () => boolean): Promise<boolean> {
  let didWork = false;

  while (!shouldStop()) {
    const claimed = await claimNextSuggestion();
    if (!claimed) break;
    didWork = true;

    try {
      await runDraft(claimed);
      console.log(`[worker] drafted ${claimed.kind} for suggestion ${claimed.id}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // A missing product or a spent allowance will not fix itself on retry.
      const retryable = !(error instanceof NonRetryableError);
      const { willRetry } = await failDraft(
        retryable ? claimed : { ...claimed, attempts: Number.MAX_SAFE_INTEGER },
        message,
      );
      console.error(
        `[worker] draft ${claimed.id} failed${willRetry ? " (will retry)" : ""}: ${message}`,
      );
    }
  }

  return didWork;
}
