import type { Config } from "@react-router/dev/config";

export default {
  // Hosts allowed to POST to UI route actions. These are matched against the
  // *hostname* of the Origin header with micromatch globs — not origin URLs,
  // so no scheme, and no RegExp (a RegExp here throws inside the check and
  // every action fails with a bare "Bad Request").
  allowedActionOrigins: [
    "admin.shopify.com",     // embedded admin iframe
    "*.myshopify.com",       // shop domains
    "*.trycloudflare.com",   // `shopify app dev` tunnel
  ],
} satisfies Config;
