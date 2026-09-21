import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { TRIAL_DAYS } from "../billing/plans";
import { HowItWorks } from "../components/how-it-works";
import { Callout } from "../components/primitives";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  // Set per deployment, so the address can change without a code release.
  return { supportEmail: process.env.SUPPORT_EMAIL || null };
};

const SETUP_STEPS: { title: string; items: string[] }[] = [
  {
    title: "Run your first scan",
    items: [
      "Open Dashboard and pick an area to scan: homepage, product pages, collections, cart, SEO, images, alt text, speed or checkout.",
      "A scan takes a minute or two. You can leave the page — results appear when it finishes.",
      "Issues are grouped into Fix first, Worth improving and Minor. Open one to see why it matters, what StoreRx recommends, and how to carry it out. Scan each area once to see the whole store.",
    ],
  },
  {
    title: "Make the change, then have StoreRx verify it",
    items: [
      "Every issue tells you where the change is made: Shopify admin, your Shopify settings, your theme editor, or your storefront copy. StoreRx never edits your store.",
      "For alt text, SEO titles, meta descriptions and product descriptions, StoreRx can draft the copy for you to review and paste in yourself.",
      "Once you have made the change, mark the issue as resolved and re-scan that area. StoreRx confirms it and marks it Verified — or tells you it is still there.",
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
    "No, and it never will. StoreRx reads your store, explains what it finds and recommends what to do — you make every change yourself. Copy it drafts for you is a suggestion to review, never applied. StoreRx blocks appear on your storefront only when you add them in the theme editor, and your theme files are never edited.",
  ],
  [
    "Why can't StoreRx measure my speed?",
    "Speed is measured with Google PageSpeed, which can't get past a storefront password. Remove the password, then run the Speed scan.",
  ],
  [
    "I fixed an issue but it's still listed. Why?",
    "Issues are updated when StoreRx checks that area again. Run a scan for the area you changed. Product issues are checked on your top products, so a product that is no longer sampled keeps its last result.",
  ],
  [
    "Does StoreRx ever stop explaining things?",
    "No — every plan, including Free, can explain more issues than a whole store contains. An explanation is written the first time StoreRx meets an issue and then reused, so re-scanning an area costs nothing. What is counted per piece is copy you ask StoreRx to draft for you: alt text, SEO titles and descriptions.",
  ],
  [
    "How are scores calculated?",
    "Each rule that finds a problem lowers its category score by its impact: high, medium or low. A problem found on many pages counts once, so larger stores aren't penalised for having more pages.",
  ],
  [
    "What does each plan include?",
    `Plans set how many scans you get each month, and how much copy StoreRx will draft for you. Paid plans start with a ${TRIAL_DAYS}-day free trial. See Plans & billing for details.`,
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
      <s-section heading="How StoreRx works">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            StoreRx checks your store for problems that cost you sales — missing trust signals, weak
            product pages, SEO gaps, heavy images and slow pages — and recommends what to do about
            each one.
          </s-paragraph>
          <HowItWorks />
          <Callout icon="shield-check-mark">
            StoreRx never edits your store. Every change is one you make yourself, in Shopify admin,
            your settings or your theme.
          </Callout>
        </s-stack>
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
              <s-button variant="secondary" icon="settings" href="/app/settings">
                Open settings
              </s-button>
              <s-button
                variant="tertiary"
                icon="paint-brush-flat"
                href="shopify://admin/themes/current/editor?context=apps"
              >
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
          <s-button variant="tertiary" icon="cash-dollar" href="/app/billing">
            Plans &amp; billing
          </s-button>
          <s-button variant="tertiary" icon="clock" href="/app/history">
            Scan history
          </s-button>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
