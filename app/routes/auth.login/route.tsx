import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";

import { login } from "../../shopify.server";

/**
 * Where the Shopify library sends a request that arrives without a session.
 * With a valid `shop` parameter, login() redirects into OAuth. Without one
 * there is nothing to ask for: App Store apps must not take a typed shop
 * domain, so the visitor goes to the landing page, which tells them to open
 * StoreRx from their Shopify admin.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  await login(request);

  throw redirect("/");
};
