import type { Config } from "@react-router/dev/config";

export default {
  // Hosts allowed to POST to UI route actions. Matched against the *hostname*
  // of the Origin header with micromatch globs — not origin URLs, so no scheme,
  // and no RegExp (a RegExp throws inside the check and every action fails
  // with a bare "Bad Request").
  //
  // The app's own host must be listed. TLS terminates at the proxy (Fly edge,
  // or the dev tunnel), so the server sees http:// while the browser's Origin
  // is https://. The origins never match as-is, so the check falls back to
  // this list — and an unlisted host rejects every action, login included.
  //
  // Evaluated at build time, when production secrets are not available, so
  // the production host is written out rather than read from SHOPIFY_APP_URL.
  // Update it if the app moves to another domain.
  allowedActionOrigins: [
    "storerx.fly.dev",       // production (fly.toml, shopify.app.toml)
    "*.trycloudflare.com",   // `shopify app dev` tunnel
    "admin.shopify.com",
    "*.myshopify.com",
  ],
} satisfies Config;
