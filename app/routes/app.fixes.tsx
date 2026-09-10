import type { LoaderFunctionArgs, HeadersFunction } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";

interface FixRecord {
  id: string;
  type: string;
  typeLabel: string;
  targetTitle: string;
  status: "preview" | "applied" | "undone";
  createdAt: string;
  appliedAt?: string;
  undoneAt?: string;
  canUndo: boolean;
}

const typeLabels: Record<string, string> = {
  product_description: "Product description",
  seo_title: "SEO title",
  seo_meta: "Meta description",
  alt_text: "Alt text",
  faq: "FAQ section",
};

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  // Get shop
  const shop = await prisma.shop.findUnique({ where: { domain: shopDomain } });

  if (!shop) {
    return { fixes: [] };
  }

  // Get fixes
  const dbFixes = await prisma.fix.findMany({
    where: { shopId: shop.id },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const now = new Date();

  const fixes: FixRecord[] = dbFixes.map((f) => {
    const canUndo = f.status === "applied" &&
      f.undoExpiresAt != null &&
      f.undoExpiresAt > now;

    return {
      id: f.id,
      type: f.type,
      typeLabel: typeLabels[f.type] || f.type,
      targetTitle: f.targetTitle,
      status: f.status as "preview" | "applied" | "undone",
      createdAt: formatDate(f.createdAt),
      appliedAt: f.appliedAt ? formatDate(f.appliedAt) : undefined,
      undoneAt: f.undoneAt ? formatDate(f.undoneAt) : undefined,
      canUndo,
    };
  });

  return { fixes };
};

const statusTone = {
  preview: "warning",
  applied: "success",
  undone: "neutral",
} as const;

const statusLabel = {
  preview: "Preview",
  applied: "Applied",
  undone: "Undone",
};

export default function Fixes() {
  const { fixes } = useLoaderData<typeof loader>();

  const appliedCount = fixes.filter((f) => f.status === "applied").length;
  const previewCount = fixes.filter((f) => f.status === "preview").length;

  return (
    <s-page heading="Fixes">
      <s-button slot="primary-action" variant="secondary">
        Export log
      </s-button>

      <s-section>
        <p style={{ margin: "0 0 16px 0", fontSize: 13, color: "#6D7175" }}>
          Every change StoreRx has made. Applied fixes can be undone for 30 days.
        </p>

        {/* Stats */}
        <div style={{ display: "flex", gap: 16, marginBottom: 16 }}>
          <s-box padding="base" borderWidth="base" borderRadius="large">
            <div style={{ fontSize: 13, color: "#6D7175" }}>Applied</div>
            <div style={{ fontSize: 24, fontWeight: 700 }}>{appliedCount}</div>
          </s-box>
          {previewCount > 0 && (
            <s-box padding="base" borderWidth="base" borderRadius="large">
              <div style={{ fontSize: 13, color: "#6D7175" }}>Pending review</div>
              <div style={{ fontSize: 24, fontWeight: 700 }}>{previewCount}</div>
            </s-box>
          )}
        </div>
      </s-section>

      {/* Fixes table */}
      <s-box borderWidth="base" borderRadius="large" padding="none">
        {/* Header */}
        <div
          style={{
            padding: "12px 20px",
            display: "grid",
            gridTemplateColumns: "100px 1fr 120px 100px 120px",
            gap: 12,
            borderBottom: "1px solid #E1E3E5",
            fontSize: 12,
            fontWeight: 600,
            color: "#6D7175",
          }}
        >
          <span>Date</span>
          <span>Target</span>
          <span>Type</span>
          <span>Status</span>
          <span style={{ textAlign: "right" }}>Actions</span>
        </div>

        {/* Rows */}
        {fixes.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: "#6D7175" }}>
            No fixes yet. Run an audit and apply AI fixes.
          </div>
        ) : (
          fixes.map((fix) => (
            <div
              key={fix.id}
              style={{
                padding: "12px 20px",
                display: "grid",
                gridTemplateColumns: "100px 1fr 120px 100px 120px",
                gap: 12,
                alignItems: "center",
                borderBottom: "1px solid #E1E3E5",
                fontSize: 13,
              }}
            >
              <span style={{ color: "#6D7175" }}>{fix.createdAt}</span>
              <div>
                <div style={{ fontWeight: 500 }}>{fix.targetTitle}</div>
              </div>
              <span>{fix.typeLabel}</span>
              <s-badge tone={statusTone[fix.status]}>{statusLabel[fix.status]}</s-badge>
              <div style={{ textAlign: "right", display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <s-button>View diff</s-button>
                {fix.canUndo && fix.status === "applied" && (
                  <s-button variant="secondary">
                    Undo
                  </s-button>
                )}
                {fix.status === "preview" && (
                  <s-button variant="primary">
                    Review
                  </s-button>
                )}
              </div>
            </div>
          ))
        )}
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
