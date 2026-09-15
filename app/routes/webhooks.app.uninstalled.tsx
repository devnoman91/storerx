import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { cancelQueuedAudits } from "../compliance.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // Webhook requests can trigger multiple times and after an app has already been uninstalled.
  // If this webhook already ran, the session may have been deleted previously.
  if (session) {
    await db.session.deleteMany({ where: { shop } });
  }

  // Shop data stays until shop/redact arrives 48 hours later, so a quick
  // reinstall keeps its history. Queued scans are dropped now: the worker
  // could no longer authenticate for this store.
  await cancelQueuedAudits(shop);

  return new Response();
};
