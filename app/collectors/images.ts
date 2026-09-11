/**
 * Catalog image collector (Admin GraphQL).
 *
 * Reads image metadata for the whole catalog — dimensions, alt text, MIME
 * type and original file size — without downloading any image. That keeps
 * the scan cheap enough to cover every product, unlike the storefront crawl
 * which samples a handful of pages (FEATURES.md §5).
 *
 * Uses `media` rather than the deprecated `Product.images`: file size is
 * only exposed on MediaImage.originalSource.
 */

import type { ImageData } from "../rules/types";

interface AdminApiClient {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
}

export interface CatalogProduct {
  id: string;
  title: string;
  handle: string;
  /** Storefront URL, for linking a finding to the page it affects. */
  url: string;
  images: ImageData[];
}

export interface CatalogImages {
  products: CatalogProduct[];
  /** Products in the store, which can exceed what was scanned. */
  totalProducts: number;
}

/** Products per request. Media per product is capped separately below. */
const PAGE_SIZE = 50;

/**
 * Upper bound on products scanned per audit. Keeps a large catalog from
 * stalling the audit on API throttling; the plan tiers in FEATURES.md §11
 * are where a full-catalog scan would be unlocked.
 */
export const MAX_SCANNED_PRODUCTS = 250;

const MAX_THROTTLE_RETRIES = 5;

const CATALOG_IMAGES_QUERY = `#graphql
  query ProductImagesForScan($first: Int!, $after: String) {
    productsCount {
      count
    }
    products(first: $first, after: $after, sortKey: ID) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        title
        handle
        onlineStoreUrl
        media(first: 25, query: "media_type:IMAGE") {
          nodes {
            ... on MediaImage {
              id
              alt
              mimeType
              status
              image {
                url
                width
                height
              }
              originalSource {
                fileSize
              }
            }
          }
        }
      }
    }
  }
`;

interface MediaNode {
  id?: string;
  alt?: string | null;
  mimeType?: string | null;
  status?: string;
  image?: { url: string; width: number; height: number } | null;
  originalSource?: { fileSize?: number | null } | null;
}

interface ProductNode {
  id: string;
  title: string;
  handle: string;
  onlineStoreUrl: string | null;
  media: { nodes: MediaNode[] };
}

interface CatalogResponse {
  data?: {
    productsCount?: { count: number };
    products?: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      nodes: ProductNode[];
    };
  };
  errors?: Array<{ message: string; extensions?: { code?: string } }>;
  extensions?: {
    cost?: {
      requestedQueryCost: number;
      throttleStatus: { currentlyAvailable: number; restoreRate: number };
    };
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Convert one media node, skipping media still processing (no image yet). */
export function toImageData(node: MediaNode): ImageData | null {
  if (!node.id || !node.image) return null;
  return {
    id: node.id,
    url: node.image.url,
    altText: node.alt ?? undefined,
    width: node.image.width,
    height: node.image.height,
    fileSize: node.originalSource?.fileSize ?? undefined,
    mimeType: node.mimeType ?? undefined,
  };
}

async function fetchPage(
  admin: AdminApiClient,
  after: string | null,
): Promise<CatalogResponse> {
  for (let attempt = 0; ; attempt++) {
    const response = await admin.graphql(CATALOG_IMAGES_QUERY, {
      variables: { first: PAGE_SIZE, after },
    });
    const body = (await response.json()) as CatalogResponse;

    const throttled = body.errors?.some((e) => e.extensions?.code === "THROTTLED");
    if (!throttled) {
      if (body.errors?.length) {
        throw new Error(`Catalog image query failed: ${body.errors[0].message}`);
      }
      return body;
    }

    if (attempt >= MAX_THROTTLE_RETRIES) {
      throw new Error("Catalog image query stayed throttled after retries");
    }
    // Wait long enough for the leaky bucket to refill the requested cost.
    const cost = body.extensions?.cost;
    const deficit = cost
      ? Math.max(0, cost.requestedQueryCost - cost.throttleStatus.currentlyAvailable)
      : 0;
    const waitMs = cost ? Math.ceil((deficit / cost.throttleStatus.restoreRate) * 1000) : 2000;
    await sleep(Math.max(waitMs, 1000));
  }
}

/**
 * Read image metadata across the catalog, up to MAX_SCANNED_PRODUCTS.
 */
export async function collectCatalogImages(
  admin: AdminApiClient,
  shopDomain: string,
): Promise<CatalogImages> {
  const products: CatalogProduct[] = [];
  let totalProducts = 0;
  let after: string | null = null;

  while (products.length < MAX_SCANNED_PRODUCTS) {
    const body = await fetchPage(admin, after);
    totalProducts = body.data?.productsCount?.count ?? totalProducts;
    const page = body.data?.products;
    if (!page) break;

    for (const node of page.nodes) {
      if (products.length >= MAX_SCANNED_PRODUCTS) break;
      products.push({
        id: node.id,
        title: node.title,
        handle: node.handle,
        url: node.onlineStoreUrl ?? `https://${shopDomain}/products/${node.handle}`,
        images: node.media.nodes
          .map(toImageData)
          .filter((image): image is ImageData => image !== null),
      });
    }

    if (!page.pageInfo.hasNextPage || !page.pageInfo.endCursor) break;
    after = page.pageInfo.endCursor;
  }

  return { products, totalProducts };
}
