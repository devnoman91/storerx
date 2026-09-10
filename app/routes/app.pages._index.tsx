import type { LoaderFunctionArgs, HeadersFunction } from "react-router";
import { useLoaderData, Link } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { getScoreBand } from "../scoring";
import prisma from "../db.server";

interface PageData {
  id: string;
  url: string;
  title: string;
  pageType: "homepage" | "collection" | "product" | "cart";
  croScore: number;
  perfScore: number;
  issueCount: number;
  lastScanned: string;
}

function formatTimeAgo(date: Date): string {
  const days = Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return `${days} days ago`;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  // Get shop
  const shop = await prisma.shop.findUnique({ where: { domain: shopDomain } });

  if (!shop) {
    return { pages: [] };
  }

  // Get latest audit
  const latestAudit = await prisma.audit.findFirst({
    where: { shopId: shop.id, status: "completed" },
    orderBy: { completedAt: "desc" },
  });

  if (!latestAudit) {
    return { pages: [] };
  }

  // Get page scores from audit
  const pageScores = await prisma.pageScore.findMany({
    where: { auditId: latestAudit.id },
    orderBy: { pageType: "asc" },
  });

  const pages: PageData[] = pageScores.map((ps) => ({
    id: ps.id,
    url: new URL(ps.pageUrl).pathname,
    title: ps.pageTitle || ps.pageType.charAt(0).toUpperCase() + ps.pageType.slice(1),
    pageType: ps.pageType as PageData["pageType"],
    croScore: ps.croScore ?? 0,
    perfScore: ps.perfScore ?? 0,
    issueCount: ps.issueCount,
    lastScanned: formatTimeAgo(ps.lastScannedAt),
  }));

  return { pages };
};

function ScoreBadge({ score, label }: { score: number; label: string }) {
  const band = getScoreBand(score);
  const colors = {
    critical: { bg: "#FFF4F4", text: "#8E1F0B" },
    warning: { bg: "#FFF8E6", text: "#8A6100" },
    success: { bg: "#F0FFF4", text: "#0D6832" },
  };
  const { bg, text } = colors[band];

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "4px 12px",
        background: bg,
        borderRadius: 6,
        minWidth: 60,
      }}
    >
      <span style={{ fontSize: 16, fontWeight: 700, color: text }}>{score}</span>
      <span style={{ fontSize: 10, color: "#6D7175" }}>{label}</span>
    </div>
  );
}

const pageTypeLabels = {
  homepage: "Homepage",
  collection: "Collection",
  product: "Product",
  cart: "Cart",
};

export default function PagesIndex() {
  const { pages } = useLoaderData<typeof loader>();

  return (
    <s-page heading="Pages">
      <s-button slot="primary-action">Run audit</s-button>

      <s-box borderWidth="base" borderRadius="large" padding="none">
        {/* Header */}
        <div
          style={{
            padding: "12px 20px",
            display: "grid",
            gridTemplateColumns: "1fr 80px 80px 80px 100px",
            gap: 12,
            borderBottom: "1px solid #E1E3E5",
            fontSize: 12,
            fontWeight: 600,
            color: "#6D7175",
          }}
        >
          <span>Page</span>
          <span style={{ textAlign: "center" }}>CRO</span>
          <span style={{ textAlign: "center" }}>Perf</span>
          <span style={{ textAlign: "center" }}>Issues</span>
          <span style={{ textAlign: "right" }}>Last scan</span>
        </div>

        {/* Rows */}
        {pages.map((page) => (
          <Link
            key={page.id}
            to={`/app/pages/${page.id}`}
            style={{ textDecoration: "none", color: "inherit" }}
          >
            <div
              style={{
                padding: "12px 20px",
                display: "grid",
                gridTemplateColumns: "1fr 80px 80px 80px 100px",
                gap: 12,
                alignItems: "center",
                borderBottom: "1px solid #E1E3E5",
                cursor: "pointer",
                fontSize: 13,
              }}
            >
              <div>
                <div style={{ fontWeight: 500 }}>{page.title}</div>
                <div style={{ fontSize: 12, color: "#6D7175" }}>
                  {pageTypeLabels[page.pageType]} • {page.url}
                </div>
              </div>
              <div style={{ display: "flex", justifyContent: "center" }}>
                <ScoreBadge score={page.croScore} label="CRO" />
              </div>
              <div style={{ display: "flex", justifyContent: "center" }}>
                <ScoreBadge score={page.perfScore} label="Perf" />
              </div>
              <div style={{ textAlign: "center" }}>
                {page.issueCount > 0 ? (
                  <s-badge tone={page.issueCount > 5 ? "critical" : "warning"}>
                    {page.issueCount}
                  </s-badge>
                ) : (
                  <s-badge tone="success">0</s-badge>
                )}
              </div>
              <div style={{ textAlign: "right", color: "#6D7175", fontSize: 12 }}>
                {page.lastScanned}
              </div>
            </div>
          </Link>
        ))}
      </s-box>

      {/* Footer help */}
      <div
        style={{
          textAlign: "center",
          fontSize: 13,
          color: "#6D7175",
          paddingTop: 24,
        }}
      >
        Need help? <s-link href="#">Read the docs</s-link> or email{" "}
        <s-link href="mailto:support@storerx.app">support@storerx.app</s-link>
      </div>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
