/**
 * Admin GraphQL Collector
 * Fetches shop data via Shopify Admin API
 */

import type {
  ShopData,
  ProductData,
  CollectionData,
  ImageData,
  VariantData,
  CheckoutSettings,
} from "../rules/types";

// GraphQL client type (from shopify.server)
interface AdminApiClient {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
}

const PRODUCTS_QUERY = `
  query GetProducts($first: Int!) {
    products(first: $first, sortKey: BEST_SELLING) {
      edges {
        node {
          id
          title
          handle
          descriptionHtml
          seo {
            title
            description
          }
          images(first: 10) {
            edges {
              node {
                id
                url
                altText
                width
                height
              }
            }
          }
          variants(first: 20) {
            edges {
              node {
                id
                title
                availableForSale
                price
              }
            }
          }
          metafield(namespace: "reviews", key: "rating") {
            value
          }
        }
      }
    }
  }
`;

const COLLECTIONS_QUERY = `
  query GetCollections($first: Int!) {
    collections(first: $first, sortKey: PRODUCTS_COUNT) {
      edges {
        node {
          id
          title
          handle
          description
          productsCount {
            count
          }
        }
      }
    }
  }
`;

const SHOP_QUERY = `
  query GetShop {
    shop {
      name
      myshopifyDomain
      checkoutApiSupported
      paymentSettings {
        supportedDigitalWallets
      }
    }
  }
`;

export async function collectAdminData(admin: AdminApiClient): Promise<ShopData> {
  const productsResponse = await admin.graphql(PRODUCTS_QUERY, {
    variables: { first: 10 },
  });
  const productsData = await productsResponse.json();

  const collectionsResponse = await admin.graphql(COLLECTIONS_QUERY, {
    variables: { first: 5 },
  });
  const collectionsData = await collectionsResponse.json();

  const shopResponse = await admin.graphql(SHOP_QUERY);
  const shopData = await shopResponse.json();

  const products: ProductData[] = (productsData.data?.products?.edges || []).map(
    (edge: any) => {
      const node = edge.node;
      const descText = node.descriptionHtml?.replace(/<[^>]*>/g, " ") || "";
      return {
        id: node.id,
        title: node.title,
        handle: node.handle,
        descriptionHtml: node.descriptionHtml || "",
        descriptionWordCount: descText.trim().split(/\s+/).length,
        images: (node.images?.edges || []).map((imgEdge: any) => ({
          id: imgEdge.node.id,
          url: imgEdge.node.url,
          altText: imgEdge.node.altText,
          width: imgEdge.node.width,
          height: imgEdge.node.height,
        })) as ImageData[],
        hasReviews: !!node.metafield?.value,
        reviewRating: node.metafield?.value ? parseFloat(node.metafield.value) : undefined,
        variants: (node.variants?.edges || []).map((varEdge: any) => ({
          id: varEdge.node.id,
          title: varEdge.node.title,
          available: varEdge.node.availableForSale,
          price: varEdge.node.price,
        })) as VariantData[],
        seoTitle: node.seo?.title,
        seoDescription: node.seo?.description,
        hasStructuredData: false,
      };
    }
  );

  const collections: CollectionData[] = (collectionsData.data?.collections?.edges || []).map(
    (edge: any) => ({
      id: edge.node.id,
      title: edge.node.title,
      handle: edge.node.handle,
      productCount: edge.node.productsCount?.count || 0,
      hasDescription: !!edge.node.description,
      hasFilters: false,
    })
  );

  const shop = shopData.data?.shop;
  const wallets = shop?.paymentSettings?.supportedDigitalWallets || [];

  const checkoutSettings: CheckoutSettings = {
    guestCheckoutEnabled: true,
    expressCheckoutEnabled: wallets.length > 0,
    shopPayEnabled: wallets.includes("SHOPIFY_PAY"),
    applePayEnabled: wallets.includes("APPLE_PAY"),
    googlePayEnabled: wallets.includes("GOOGLE_PAY"),
    shippingOptionsCount: 1,
    paymentMethodsCount: 1 + wallets.length,
    tippingEnabled: false,
  };

  return {
    domain: shop?.myshopifyDomain || "",
    products,
    collections,
    checkoutSettings,
    installedApps: [],
  };
}

export async function collectAllProductImages(
  admin: AdminApiClient,
  limit = 50
): Promise<Array<{ productId: string; productTitle: string; images: ImageData[] }>> {
  const response = await admin.graphql(PRODUCTS_QUERY, {
    variables: { first: limit },
  });
  const data = await response.json();

  return (data.data?.products?.edges || []).map((edge: any) => ({
    productId: edge.node.id,
    productTitle: edge.node.title,
    images: (edge.node.images?.edges || []).map((imgEdge: any) => ({
      id: imgEdge.node.id,
      url: imgEdge.node.url,
      altText: imgEdge.node.altText,
      width: imgEdge.node.width,
      height: imgEdge.node.height,
    })),
  }));
}
