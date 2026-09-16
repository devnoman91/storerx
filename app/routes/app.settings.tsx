import type { LoaderFunctionArgs, ActionFunctionArgs, HeadersFunction } from "react-router";
import { useLoaderData, useFetcher, useNavigate } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { planOf } from "../billing/plans";
import { Callout } from "../components/primitives";

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
    planLabel: planOf(shop.plan).label,
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

const SCHEDULES: Array<[string, string]> = [
  ["manual", "Only when I ask"],
  ["weekly", "Weekly"],
  ["monthly", "Monthly"],
];

/** What the storefront password field should say, which depends on two things. */
function passwordHelp(protectedStore: boolean, saved: boolean): string {
  if (!protectedStore) return "Your storefront is public, so scans don't need a password.";
  if (saved) {
    return "A password is saved. Enter a new one only if you want to change it.";
  }
  return (
    "Your store is password-protected, so scans can only see the password page until you add it " +
    "here. Find it in Shopify admin under Online Store → Preferences."
  );
}

export default function Settings() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const isSaving = fetcher.state !== "idle";
  const navigate = useNavigate();
  const justSaved = fetcher.state === "idle" && fetcher.data?.success === true;
  const needsPassword = data.passwordProtected && !data.hasStorefrontPassword;

  return (
    <s-page heading="Settings">
      {/* Must be a direct child of s-page: `slot` only applies to host children. */}
      <s-button slot="navigation" variant="tertiary" onClick={() => navigate("/app")}>
        ← Back
      </s-button>

      {justSaved && <s-banner tone="success" heading="Settings saved" />}

      {needsPassword && (
        <s-banner tone="warning" heading="StoreRx can't see your storefront">
          Your store is password-protected, so scans only reach the password page. Add your
          storefront password below to scan your real pages.
        </s-banner>
      )}

      <fetcher.Form method="post">
        <s-section heading="How StoreRx writes for you">
          <s-stack direction="block" gap="base">
            <s-text-area
              name="brandVoice"
              label="Brand voice"
              details="Paste a sample of your own writing. StoreRx matches this tone when it explains an issue or drafts copy for you."
              defaultValue={data.brandVoice}
              placeholder="We're friendly and direct. We avoid jargon and speak plainly to our customers…"
              rows={4}
            />
            <Callout icon="wand">
              Changing this rewrites future recommendations. Ones StoreRx has already written stay
              as they are until the issue is found again.
            </Callout>
          </s-stack>
        </s-section>

        <s-section heading="Access to your storefront">
          <s-password-field
            name="storefrontPassword"
            label="Storefront password"
            details={passwordHelp(data.passwordProtected, data.hasStorefrontPassword)}
            placeholder={data.hasStorefrontPassword ? "•••••••• (saved)" : "Storefront password"}
            autocomplete="off"
            disabled={!data.passwordProtected}
          />
        </s-section>

        <s-section heading="Scanning">
          <s-stack direction="block" gap="base">
            {/* s-select takes its initial value from the selected option,
                not a defaultValue prop. */}
            <s-select
              name="auditSchedule"
              label="Automatic scans"
              details="Scheduled scans count towards your plan just like ones you start yourself."
            >
              {SCHEDULES.map(([value, label]) => (
                <s-option
                  key={value}
                  value={value}
                  defaultSelected={data.auditSchedule === value}
                >
                  {label}
                </s-option>
              ))}
            </s-select>

            <s-checkbox
              name="emailSummary"
              label="Email me when a scan finishes"
              details="A summary of what changed — new issues, and ones StoreRx verified."
              defaultChecked={data.emailSummary}
            />
          </s-stack>
        </s-section>

        <s-section>
          <s-stack direction="inline" gap="small" alignItems="center" justifyContent="space-between">
            <s-stack direction="inline" gap="small-300" alignItems="center">
              <s-text color="subdued">Current plan</s-text>
              <s-badge tone="neutral">{data.planLabel}</s-badge>
              <s-link href="/app/billing">Change</s-link>
            </s-stack>
            <s-button variant="primary" type="submit" loading={isSaving} disabled={isSaving}>
              Save settings
            </s-button>
          </s-stack>
        </s-section>
      </fetcher.Form>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
