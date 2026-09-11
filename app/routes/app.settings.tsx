import type { LoaderFunctionArgs, ActionFunctionArgs, HeadersFunction } from "react-router";
import { useLoaderData, useFetcher, useNavigate } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shopDomain = session.shop;

  // Admin API only — no storefront fetch here. Tells the merchant whether
  // scans need the storefront password at all.
  const protection = await admin.graphql(`#graphql
    query StorefrontPasswordProtection {
      onlineStore { passwordProtection { enabled } }
    }`);
  const passwordProtected =
    (await protection.json()).data?.onlineStore?.passwordProtection?.enabled === true;

  let shop = await prisma.shop.findUnique({ where: { domain: shopDomain } });
  if (!shop) {
    shop = await prisma.shop.create({ data: { domain: shopDomain } });
  }

  return {
    brandVoice: shop.brandVoice || "",
    auditSchedule: shop.auditSchedule,
    emailSummary: shop.emailSummary,
    plan: shop.plan,
    passwordProtected,
    // Whether one is saved — the password itself never leaves the server.
    hasStorefrontPassword: Boolean(shop.storefrontPassword),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const formData = await request.formData();

  // Blank means "keep the saved one": the field is never pre-filled.
  const storefrontPassword = ((formData.get("storefrontPassword") as string) || "").trim();

  const settings = {
    brandVoice: (formData.get("brandVoice") as string) || null,
    auditSchedule: (formData.get("auditSchedule") as string) || "weekly",
    emailSummary: formData.get("emailSummary") === "on",
    ...(storefrontPassword ? { storefrontPassword } : {}),
  };

  // Upsert: the loader creates the shop row, but a POST can arrive first.
  await prisma.shop.upsert({
    where: { domain: shopDomain },
    update: settings,
    create: { domain: shopDomain, ...settings },
  });

  return { success: true };
};

export default function Settings() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const isSaving = fetcher.state !== "idle";
  const navigate = useNavigate();
  const justSaved = fetcher.state === "idle" && fetcher.data?.success === true;

  return (
    <s-page heading="Settings">
      {/* Must be a direct child of s-page: `slot` only applies to host children. */}
      <s-button slot="navigation" variant="tertiary" onClick={() => navigate("/app")}>
        ← Back
      </s-button>

      {justSaved && <s-banner tone="success" heading="Settings saved" />}

      <fetcher.Form method="post">
        {/* Brand Voice */}
        <div style={{ marginBottom: 24 }}>
          <label htmlFor="brandVoice" style={{ display: "block", fontSize: 14, fontWeight: 500, marginBottom: 8 }}>
            Brand Voice (optional)
          </label>
          <p style={{ fontSize: 13, color: "#6B7280", margin: "0 0 8px 0" }}>
            Paste a sample of your writing style. AI will match this tone.
          </p>
          <textarea
            id="brandVoice"
            name="brandVoice"
            defaultValue={data.brandVoice}
            placeholder="e.g., We're friendly and casual. We avoid jargon and speak directly to our customers..."
            style={{
              width: "100%",
              minHeight: 100,
              padding: 12,
              border: "1px solid #D1D5DB",
              borderRadius: 8,
              fontSize: 14,
              resize: "vertical",
            }}
          />
        </div>

        {/* Storefront password */}
        <div style={{ marginBottom: 24 }}>
          <label htmlFor="storefrontPassword" style={{ display: "block", fontSize: 14, fontWeight: 500, marginBottom: 8 }}>
            Storefront password
          </label>
          <p style={{ fontSize: 13, color: data.passwordProtected && !data.hasStorefrontPassword ? "#92400E" : "#6B7280", margin: "0 0 8px 0" }}>
            {data.passwordProtected
              ? data.hasStorefrontPassword
                ? "Your store is password-protected. A password is saved — enter a new one only to change it."
                : "Your store is password-protected, so scans can only see the password page until you add it here. Find it in Shopify admin under Online Store → Preferences."
              : "Your storefront is public, so scans don't need a password."}
          </p>
          <input
            id="storefrontPassword"
            name="storefrontPassword"
            type="password"
            autoComplete="off"
            placeholder={data.hasStorefrontPassword ? "•••••••• (saved)" : "Storefront password"}
            style={{
              width: "100%",
              maxWidth: 320,
              padding: "8px 12px",
              border: "1px solid #D1D5DB",
              borderRadius: 8,
              fontSize: 14,
            }}
          />
        </div>

        {/* Scan Schedule */}
        <div style={{ marginBottom: 24 }}>
          <label htmlFor="auditSchedule" style={{ display: "block", fontSize: 14, fontWeight: 500, marginBottom: 8 }}>
            Auto-scan Schedule
          </label>
          <select
            id="auditSchedule"
            name="auditSchedule"
            defaultValue={data.auditSchedule}
            style={{
              padding: "8px 12px",
              border: "1px solid #D1D5DB",
              borderRadius: 8,
              fontSize: 14,
            }}
          >
            <option value="manual">Manual only</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
        </div>

        {/* Email */}
        <div style={{ marginBottom: 24 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
            <input
              type="checkbox"
              name="emailSummary"
              defaultChecked={data.emailSummary}
            />
            <span style={{ fontSize: 14 }}>Email me scan results</span>
          </label>
        </div>

        <s-button variant="primary" type="submit" disabled={isSaving}>
          {isSaving ? "Saving..." : "Save Settings"}
        </s-button>
      </fetcher.Form>

      {/* Plan Info */}
      <div style={{
        marginTop: 32,
        paddingTop: 24,
        borderTop: "1px solid #E5E7EB",
      }}>
        <h3 style={{ fontSize: 14, fontWeight: 500, margin: "0 0 8px 0" }}>Current Plan</h3>
        <p style={{ fontSize: 14, color: "#6B7280", margin: 0 }}>
          {data.plan === "free" ? "Free Plan" : `${data.plan.charAt(0).toUpperCase() + data.plan.slice(1)} Plan`}
        </p>
      </div>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
