import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  BillingInterval,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
import { PLANS, SHOPIFY_PLAN_NAMES, TRIAL_DAYS, type PaidPlanKey } from "./billing/plans";

const recurringPlan = (key: PaidPlanKey) => ({
  trialDays: TRIAL_DAYS,
  lineItems: [
    { amount: PLANS[key].price, currencyCode: "USD", interval: BillingInterval.Every30Days as const },
  ],
});

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.October25,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  // Keyed by the name merchants see on the approval screen (app/billing/plans.ts).
  billing: {
    [SHOPIFY_PLAN_NAMES.starter]: recurringPlan("starter"),
    [SHOPIFY_PLAN_NAMES.growth]: recurringPlan("growth"),
    [SHOPIFY_PLAN_NAMES.pro]: recurringPlan("pro"),
  },
  future: {
    expiringOfflineAccessTokens: true,
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.October25;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
