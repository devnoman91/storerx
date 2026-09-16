import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { TRIAL_DAYS } from "../billing/plans";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  // Set per deployment, so the address can change without a code release.
  return { supportEmail: process.env.SUPPORT_EMAIL || null };
};

const SETUP_STEPS: { title: string; items: string[] }[] = [
  {
    title: "Run your first scan",
    items: [
      "Open Dashboard and choose Run full scan. It checks your homepage, top collections, top products, SEO, images, speed and checkout settings.",
      "A full scan takes a few minutes. You can leave the page — results appear when it finishes.",
      "Issues are grouped into Fix Now, Improvements and Minor, with what each one affects.",
    ],
  },
  {
    title: "Re-check one area at a time",
    items: [
      "After you fix something, scan just that area (homepage, product pages, collections, SEO, images or alt text).",
      "An area scan is faster and only updates issues in that area. Fixed issues move to Fixed in the last 14 days.",
      "History lists every scan with its score, new issues and fixed issues.",
    ],
  },
  {
    title: "Set up StoreRx for your store",
    items: [
      "Password-protected store? Add your storefront password in Settings so StoreRx can see your real pages.",
      "Add a brand voice sample in Settings so explanations match how your store talks.",
      "Add the StoreRx blocks (FAQ, trust badges, cross-sells) and the shipping bar embed in the theme editor.",
    ],
  },
];

const FAQS: [string, string][] = [
  [
    "Does StoreRx change my store?",
    "No. Scans only read your store. StoreRx blocks appear on your storefront only when you add them in the theme editor, and your theme files are never edited.",
  ],
  [
    "Why does performance say not measured?",
    "Speed is measured with Google PageSpeed, which can't get past a storefront password. Remove the password, or run a full scan once your store is live.",
  ],
  [
    "I fixed an issue but it's still listed. Why?",
    "Issues are updated when StoreRx checks that area again. Run a scan for the area you changed. Product issues are checked on your top products, so a product that is no longer sampled keeps its last result.",
  ],
  [
    "How are scores calculated?",
    "Each rule that finds a problem lowers its category score by its impact: high, medium or low. A problem found on many pages counts once, so larger stores aren't penalised for having more pages.",
  ],
  [
    "What does each plan include?",
    `Plans set how many scans and AI explanations you get each month. Paid plans start with a ${TRIAL_DAYS}-day free trial. See Plans & billing for details.`,
  ],
  [
    "What data does StoreRx store?",
    "Your shop domain, scan results and settings. StoreRx doesn't read or store customer or order data, and everything is deleted 48 hours after you uninstall.",
  ],
];

export default function Help() {
  const { supportEmail } = useLoaderData<typeof loader>();

  return (
    <s-page heading="Help">
      <s-section heading="Getting started">
        <s-paragraph>
          StoreRx checks your store for problems that cost you sales — missing trust signals, weak
          product pages, SEO gaps, heavy images and slow pages — and explains how to fix each one.
        </s-paragraph>
      </s-section>

      {SETUP_STEPS.map((step, index) => (
        <s-section key={step.title} heading={`${index + 1}. ${step.title}`}>
          <s-unordered-list>
            {step.items.map((item) => (
              <s-list-item key={item}>{item}</s-list-item>
            ))}
          </s-unordered-list>
          {index === 2 && (
            <s-stack direction="inline" gap="small">
              <s-button href="/app/settings">Open Settings</s-button>
              <s-button href="shopify://admin/themes/current/editor?context=apps" target="_top">
                Open theme editor
              </s-button>
            </s-stack>
          )}
        </s-section>
      ))}

      <s-section heading="Frequently asked questions">
        <s-stack direction="block" gap="base">
          {FAQS.map(([question, answer]) => (
            <s-stack key={question} direction="block" gap="small-500">
              <s-text type="strong">{question}</s-text>
              <s-paragraph color="subdued">{answer}</s-paragraph>
            </s-stack>
          ))}
        </s-stack>
      </s-section>

      <s-section heading="Contact support">
        {supportEmail ? (
          <s-stack direction="block" gap="small">
            <s-paragraph>Stuck, or found something that looks wrong? Email us and we&apos;ll get back to you.</s-paragraph>
            <s-link href={`mailto:${supportEmail}`}>{supportEmail}</s-link>
          </s-stack>
        ) : (
          <s-paragraph color="subdued">Support contact details will be added here soon.</s-paragraph>
        )}
      </s-section>

      <s-section heading="More">
        <s-stack direction="inline" gap="small">
          <s-button href="/app/billing">Plans & billing</s-button>
          <s-button href="/app/history">Scan history</s-button>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
