import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { normalizeComplianceTopic, redactShopData } from "../compliance.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  // Verifies the HMAC first: an invalid signature throws a 401 response,
  // which Shopify's compliance requirements demand.
  const { shop, topic } = await authenticate.webhook(request);

  // Payloads contain customer email and phone, so they are never logged.
  switch (normalizeComplianceTopic(topic)) {
    case "CUSTOMERS_DATA_REQUEST":
    case "CUSTOMERS_REDACT":
      console.log(`[compliance] ${topic} for ${shop}: StoreRx holds no customer data`);
      break;
    case "SHOP_REDACT": {
      const deleted = await redactShopData(shop);
      console.log(
        `[compliance] ${topic} for ${shop}: removed ${deleted.shops} shop record(s) ` +
          `and ${deleted.sessions} session(s)`,
      );
      break;
    }
    default:
      console.warn(`[compliance] ignoring unexpected topic ${topic} for ${shop}`);
  }

  return new Response();
};
