import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { applySubscriptionEvent } from "../billing/plans";
import { billingState, saveBillingState } from "../billing/billing.server";

interface AppSubscriptionPayload {
  app_subscription?: {
    admin_graphql_api_id?: string;
    name?: string;
    status?: string;
  };
}

/**
 * app_subscriptions/update: a plan was approved, cancelled, declined, frozen
 * or expired — including changes made outside StoreRx, such as a store being
 * closed. Keeps the plan stored on the shop in step with Shopify.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop: shopDomain, payload } = await authenticate.webhook(request);

  const subscription = (payload as AppSubscriptionPayload).app_subscription;
  if (!subscription?.admin_graphql_api_id || !subscription.name || !subscription.status) {
    console.warn(`[billing] ignoring subscription update without id, name or status for ${shopDomain}`);
    return new Response();
  }

  const shop = await prisma.shop.upsert({
    where: { domain: shopDomain },
    create: { domain: shopDomain },
    update: {},
  });

  const next = applySubscriptionEvent(billingState(shop), {
    id: subscription.admin_graphql_api_id,
    name: subscription.name,
    status: subscription.status,
  });
  if (next) {
    await saveBillingState(shop, next);
    console.log(`[billing] ${shopDomain}: ${subscription.name} ${subscription.status} → plan ${next.plan}`);
  }

  return new Response();
};
