/**
 * Admin GraphQL Collector
 *
 * Fetches store data via Shopify Admin GraphQL API:
 * - Products, collections, media
 * - Theme settings
 * - Installed apps
 * - Shop settings
 * - Top sellers from orders
 */

import type { ShopData, ProductData, CollectionData, CheckoutSettings } from "../rules/types";

export interface AdminCollectorOptions {
  /** Shopify Admin GraphQL client */
  admin: {
    graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
  };
  /** Maximum products to fetch (default: 5 top sellers) */
  maxProducts?: number;
  /** Maximum collections to fetch (default: 3 largest) */
  maxCollections?: number;
}

/**
 * Collect store data from Admin GraphQL
 */
export async function collectAdminData(options: AdminCollectorOptions): Promise<ShopData> {
  const { admin, maxProducts = 5, maxCollections = 3 } = options;

  // TODO: Implement actual GraphQL queries
  // This is a placeholder structure

  const shopData: ShopData = {
    domain: "",
    products: [],
    collections: [],
    checkoutSettings: {
      guestCheckoutEnabled: true,
      expressCheckoutEnabled: true,
      shopPayEnabled: false,
      applePayEnabled: false,
      googlePayEnabled: false,
      shippingOptionsCount: 0,
      paymentMethodsCount: 0,
      tippingEnabled: false,
    },
    installedApps: [],
  };

  return shopData;
}

/**
 * Fetch top-selling products from last 30 days
 */
export async function fetchTopSellingProducts(
  admin: AdminCollectorOptions["admin"],
  limit: number = 5
): Promise<ProductData[]> {
  // TODO: Query orders from last 30 days, aggregate by product
  // Fallback to newest products if no orders
  return [];
}

/**
 * Fetch largest collections by product count
 */
export async function fetchLargestCollections(
  admin: AdminCollectorOptions["admin"],
  limit: number = 3
): Promise<CollectionData[]> {
  // TODO: Query collections sorted by product count
  return [];
}

/**
 * Fetch checkout settings
 */
export async function fetchCheckoutSettings(
  admin: AdminCollectorOptions["admin"]
): Promise<CheckoutSettings> {
  // TODO: Query shop checkout settings
  return {
    guestCheckoutEnabled: true,
    expressCheckoutEnabled: true,
    shopPayEnabled: false,
    applePayEnabled: false,
    googlePayEnabled: false,
    shippingOptionsCount: 0,
    paymentMethodsCount: 0,
    tippingEnabled: false,
  };
}
