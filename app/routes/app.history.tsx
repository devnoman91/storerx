import type { LoaderFunctionArgs, HeadersFunction } from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const shop = await prisma.shop.findUnique({ where: { domain: shopDomain } });
  if (!shop) {
    return { fixes: [] };
  }

  const fixes = await prisma.fix.findMany({
    where: { shopId: shop.id },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return {
    fixes: fixes.map(f => ({
      id: f.id,
      type: f.type,
      target: f.targetTitle,
      status: f.status,
      date: f.appliedAt?.toLocaleDateString() || f.createdAt.toLocaleDateString(),
      canUndo: Boolean(
        f.status === "applied" && f.undoExpiresAt && f.undoExpiresAt > new Date(),
      ),
    })),
  };
};

const typeLabels: Record<string, string> = {
  product_description: "Description",
  seo_title: "SEO Title",
  seo_meta: "Meta Description",
  alt_text: "Alt Text",
  faq: "FAQ",
};

const statusLabels: Record<string, { label: string; color: string }> = {
  preview: { label: "Pending", color: "#F59E0B" },
  applied: { label: "Applied", color: "#10B981" },
  undone: { label: "Undone", color: "#6B7280" },
};

export default function History() {
  const { fixes } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  return (
    <s-page heading="Fix History">
      {/* Must be a direct child of s-page: `slot` only applies to host children. */}
      <s-button slot="navigation" variant="tertiary" onClick={() => navigate("/app")}>
        ← Back
      </s-button>

      {fixes.length === 0 ? (
        <div style={{
          textAlign: "center",
          padding: 48,
          background: "#F9FAFB",
          borderRadius: 12,
        }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>📝</div>
          <h2 style={{ fontSize: 18, fontWeight: 600, margin: "0 0 8px 0" }}>
            No fixes yet
          </h2>
          <p style={{ fontSize: 14, color: "#6B7280", margin: 0 }}>
            When you fix issues with AI, they&apos;ll appear here.
          </p>
        </div>
      ) : (
        <div style={{ border: "1px solid #E5E7EB", borderRadius: 12, overflow: "hidden" }}>
          {fixes.map((fix, i) => (
            <div
              key={fix.id}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 100px 100px 100px",
                gap: 16,
                padding: "16px 20px",
                alignItems: "center",
                borderBottom: i < fixes.length - 1 ? "1px solid #E5E7EB" : undefined,
                fontSize: 14,
              }}
            >
              <div>
                <div style={{ fontWeight: 500 }}>{fix.target}</div>
                <div style={{ fontSize: 12, color: "#6B7280" }}>
                  {typeLabels[fix.type] || fix.type}
                </div>
              </div>
              <div style={{ color: "#6B7280" }}>{fix.date}</div>
              <div>
                <span style={{
                  padding: "4px 8px",
                  borderRadius: 4,
                  fontSize: 12,
                  fontWeight: 500,
                  background: fix.status === "applied" ? "#D1FAE5" : "#F3F4F6",
                  color: statusLabels[fix.status]?.color || "#6B7280",
                }}>
                  {statusLabels[fix.status]?.label || fix.status}
                </span>
              </div>
              <div style={{ textAlign: "right" }}>
                {fix.canUndo && (
                  <s-button variant="tertiary">Undo</s-button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
