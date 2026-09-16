import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useActionData, useLoaderData, useNavigation, useRouteError, useSubmit } from "react-router";
import { useState } from "react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  BillingUnavailableError,
  cancelPlan,
  getShopUsage,
  isTestBilling,
  requestPlan,
  syncSubscription,
} from "../billing/billing.server";
import { PLANS, PLAN_ORDER, TRIAL_DAYS, isPaidPlanKey, type PlanKey } from "../billing/plans";

async function loadShop(shopDomain: string) {
  return prisma.shop.upsert({ where: { domain: shopDomain }, create: { domain: shopDomain }, update: {} });
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const context = await authenticate.admin(request);
  const shopDomain = context.session.shop;

  let shop = await loadShop(shopDomain);
  const isTest = await isTestBilling(context.admin);
  const sync = await syncSubscription(shop, context, isTest);
  if (sync.available) shop = await loadShop(shopDomain);
  const usage = await getShopUsage(shop);

  const url = new URL(request.url);
  const periodEnd = sync.available ? sync.subscription?.currentPeriodEnd : null;

  return {
    billingAvailable: sync.available,
    currentPlan: usage.plan.key,
    isTest,
    justSubscribed: url.searchParams.get("subscribed") === "1" && usage.plan.key !== "free",
    renewsOn: periodEnd ? new Date(periodEnd).toDateString() : null,
    resetsAt: usage.resetsAt.toDateString(),
    usage: usage.usage,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const context = await authenticate.admin(request);
  const shopDomain = context.session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");

  try {
    const isTest = await isTestBilling(context.admin);

    if (intent === "subscribe") {
      const plan = formData.get("plan");
      if (!isPaidPlanKey(plan)) return { ok: false as const, error: "Choose a paid plan." };
      // Throws a redirect to Shopify's approval screen.
      return await requestPlan(context, shopDomain, plan, isTest);
    }

    if (intent === "cancel") {
      const shop = await loadShop(shopDomain);
      await cancelPlan(shop, context, isTest);
      return { ok: true as const, message: "Your plan was cancelled. You're on the Free plan now." };
    }

    return { ok: false as const, error: `Unsupported action: ${String(intent)}` };
  } catch (error) {
    if (error instanceof Response) throw error;
    if (error instanceof BillingUnavailableError) return { ok: false as const, error: error.message };
    console.error(`[billing] ${String(intent)} failed for ${shopDomain}:`, error);
    return { ok: false as const, error: "Shopify couldn't complete that billing change. Please try again." };
  }
};

function limitText(used: number, limit: number | null): string {
  return limit === null ? `${used} used · unlimited` : `${used} of ${limit} used`;
}

const FAQ: [string, string][] = [
  [
    "How does billing work?",
    "Paid plans are billed by Shopify every 30 days and appear on your Shopify invoice. You approve the charge in Shopify before anything is billed.",
  ],
  [
    "Is there a free trial?",
    `Every paid plan starts with a ${TRIAL_DAYS}-day free trial. Cancel before it ends and you aren't charged.`,
  ],
  [
    "Can I change or cancel my plan?",
    "Yes, any time. Choosing another plan replaces the current one. Cancelling moves you to the Free plan straight away, with a prorated refund from Shopify.",
  ],
  [
    "What counts towards my limits?",
    "Every scan you start counts towards your plan, apart from scans that fail. AI explanations are only generated the first time StoreRx sees an issue, so running the same scan again doesn't use more of them.",
  ],
];

export default function Billing() {
  const data = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const [confirmCancel, setConfirmCancel] = useState(false);

  const busy = navigation.state !== "idle";
  const current = PLANS[data.currentPlan];

  const choose = (plan: PlanKey) => submit({ intent: "subscribe", plan }, { method: "post" });
  const cancel = () => {
    setConfirmCancel(false);
    submit({ intent: "cancel" }, { method: "post" });
  };

  return (
    <s-page heading="Plans & billing">
      {data.justSubscribed && (
        <s-banner tone="success" heading={`You're on the ${current.label} plan`}>
          Thanks for subscribing. Your new limits apply right away.
        </s-banner>
      )}
      {result && !result.ok && (
        <s-banner tone="critical" heading="Billing change not made">
          {result.error}
        </s-banner>
      )}
      {result && result.ok && <s-banner tone="success">{result.message}</s-banner>}
      {!data.billingAvailable && (
        <s-banner tone="warning" heading="Paid plans aren't available yet">
          Shopify only allows billing for apps with public distribution. Everyone uses the Free plan
          until StoreRx is published.
        </s-banner>
      )}
      {data.billingAvailable && data.isTest && (
        <s-banner tone="info" heading="Test charges">
          This is a development store, so plans are approved as test charges and nothing is billed.
        </s-banner>
      )}

      <s-section heading={`Current plan: ${current.label}`}>
        <s-stack direction="block" gap="small">
          <s-text>Full scans: {limitText(data.usage.fullScans, current.limits.fullScans)}</s-text>
          <s-text>Single-area scans: {limitText(data.usage.areaScans, current.limits.areaScans)}</s-text>
          <s-text>AI explanations: {limitText(data.usage.aiExplanations, current.limits.aiExplanations)}</s-text>
          <s-text color="subdued">
            Limits reset on {data.resetsAt}.{data.renewsOn ? ` Your plan renews on ${data.renewsOn}.` : ""}
          </s-text>
          {current.key !== "free" && data.billingAvailable && (
            <s-stack direction="inline" gap="small">
              {confirmCancel ? (
                <>
                  <s-button tone="critical" disabled={busy} onClick={cancel}>
                    Yes, cancel my plan
                  </s-button>
                  <s-button variant="tertiary" onClick={() => setConfirmCancel(false)}>
                    Keep my plan
                  </s-button>
                </>
              ) : (
                <s-button variant="secondary" tone="critical" disabled={busy} onClick={() => setConfirmCancel(true)}>
                  Cancel plan
                </s-button>
              )}
            </s-stack>
          )}
        </s-stack>
      </s-section>

      <s-section heading="Plans">
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(200px, 1fr))" gap="base">
          {PLAN_ORDER.map((key) => {
            const plan = PLANS[key];
            const isCurrent = key === data.currentPlan;
            return (
              <s-box key={key} padding="base" border="base" borderRadius="base">
                <s-stack direction="block" gap="small">
                  <s-stack direction="inline" gap="small" alignItems="center">
                    <s-heading>{plan.label}</s-heading>
                    {isCurrent && <s-badge tone="success">Current</s-badge>}
                  </s-stack>
                  <s-text type="strong">{plan.price === 0 ? "Free" : `$${plan.price} / 30 days`}</s-text>
                  <s-text color="subdued">{plan.summary}</s-text>
                  <s-unordered-list>
                    {plan.features.map((feature) => (
                      <s-list-item key={feature}>{feature}</s-list-item>
                    ))}
                  </s-unordered-list>
                  {key !== "free" && !isCurrent && (
                    <s-button
                      variant="primary"
                      disabled={busy || !data.billingAvailable}
                      onClick={() => choose(key)}
                    >
                      {`Start ${TRIAL_DAYS}-day trial`}
                    </s-button>
                  )}
                </s-stack>
              </s-box>
            );
          })}
        </s-grid>
      </s-section>

      <s-section heading="Questions">
        <s-stack direction="block" gap="base">
          {FAQ.map(([question, answer]) => (
            <s-stack key={question} direction="block" gap="small-500">
              <s-text type="strong">{question}</s-text>
              <s-paragraph color="subdued">{answer}</s-paragraph>
            </s-stack>
          ))}
        </s-stack>
      </s-section>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
