import type { LoaderFunctionArgs, ActionFunctionArgs, HeadersFunction } from "react-router";
import { useLoaderData, useFetcher, Link } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  let shop = await prisma.shop.findUnique({ where: { domain: shopDomain } });
  if (!shop) {
    shop = await prisma.shop.create({ data: { domain: shopDomain } });
  }

  return {
    brandVoice: shop.brandVoice || "",
    auditSchedule: shop.auditSchedule,
    emailSummary: shop.emailSummary,
    plan: shop.plan,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const formData = await request.formData();

  await prisma.shop.update({
    where: { domain: shopDomain },
    data: {
      brandVoice: formData.get("brandVoice") as string || null,
      auditSchedule: formData.get("auditSchedule") as string || "weekly",
      emailSummary: formData.get("emailSummary") === "on",
    },
  });

  return { success: true };
};

export default function Settings() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const isSaving = fetcher.state !== "idle";

  return (
    <s-page heading="Settings">
      <Link to="/app" style={{ textDecoration: "none" }}>
        <s-button slot="navigation" variant="tertiary">← Back</s-button>
      </Link>

      <fetcher.Form method="post">
        {/* Brand Voice */}
        <div style={{ marginBottom: 24 }}>
          <label style={{ display: "block", fontSize: 14, fontWeight: 500, marginBottom: 8 }}>
            Brand Voice (optional)
          </label>
          <p style={{ fontSize: 13, color: "#6B7280", margin: "0 0 8px 0" }}>
            Paste a sample of your writing style. AI will match this tone.
          </p>
          <textarea
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

        {/* Scan Schedule */}
        <div style={{ marginBottom: 24 }}>
          <label style={{ display: "block", fontSize: 14, fontWeight: 500, marginBottom: 8 }}>
            Auto-scan Schedule
          </label>
          <select
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
