import type { LoaderFunctionArgs, ActionFunctionArgs, HeadersFunction } from "react-router";
import { useLoaderData, useFetcher, Link } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { collectAdminData } from "../collectors/admin";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  // Get or create shop record
  let shop = await prisma.shop.findUnique({ where: { domain: shopDomain } });
  if (!shop) {
    shop = await prisma.shop.create({ data: { domain: shopDomain } });
  }

  // Get latest audit
  const latestAudit = await prisma.audit.findFirst({
    where: { shopId: shop.id, status: "completed" },
    orderBy: { completedAt: "desc" },
    include: {
      findings: {
        where: { status: "open" },
        orderBy: [{ severity: "asc" }, { createdAt: "desc" }],
      },
    },
  });

  // Count by severity
  const critical = latestAudit?.findings.filter(f => f.severity === "high") || [];
  const improvements = latestAudit?.findings.filter(f => f.severity === "medium") || [];
  const minor = latestAudit?.findings.filter(f => f.severity === "low") || [];

  // Get fix count
  const fixCount = await prisma.fix.count({
    where: { shopId: shop.id, status: "applied" },
  });

  return {
    shopDomain,
    hasAudit: !!latestAudit,
    lastAuditDate: latestAudit?.completedAt?.toLocaleDateString() || null,
    critical,
    improvements,
    minor,
    fixCount,
    overallScore: latestAudit?.overallScore ?? 0,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  let shop = await prisma.shop.findUnique({ where: { domain: shopDomain } });
  if (!shop) {
    shop = await prisma.shop.create({ data: { domain: shopDomain } });
  }

  // Collect shop data
  const shopData = await collectAdminData(admin);

  // Create audit
  const audit = await prisma.audit.create({
    data: { shopId: shop.id, status: "running", startedAt: new Date() },
  });

  try {
    const { runRulesWithSummary } = await import("../rules");
    const { collectStorefrontPage, buildAuditPageList } = await import("../collectors/storefront");
    const { runLighthouseAudit } = await import("../collectors/lighthouse");
    const { calculateStoreHealth } = await import("../scoring");

    const allFindings: Array<{
      ruleId: string;
      pageType: string;
      severity: string;
      title: string;
      fixableByAI: boolean;
      fixType?: string;
      targetId?: string;
    }> = [];

    // Build page list
    const pages = buildAuditPageList(
      shopDomain,
      shopData.collections.map(c => ({ handle: c.handle })),
      shopData.products.map(p => ({ handle: p.handle }))
    );

    // Scan homepage
    const homepage = await collectStorefrontPage(`https://${shopDomain}`, "homepage", { domain: shopDomain });
    const homepageRules = runRulesWithSummary("homepage", { html: homepage.html, shopData });
    allFindings.push(...homepageRules.findings.map(f => ({
      ruleId: f.ruleId,
      pageType: "homepage",
      severity: f.severity,
      title: f.title,
      fixableByAI: f.fixableByAI,
      fixType: f.fixType,
      targetId: f.targetId,
    })));

    // Scan products
    for (const page of pages.filter(p => p.type === "product").slice(0, 3)) {
      const prodPage = await collectStorefrontPage(page.url, "product", { domain: shopDomain });
      const prodRules = runRulesWithSummary("product", { html: prodPage.html, shopData });
      allFindings.push(...prodRules.findings.map(f => ({
        ruleId: f.ruleId,
        pageType: "product",
        severity: f.severity,
        title: f.title,
        fixableByAI: f.fixableByAI,
        fixType: f.fixType,
        targetId: f.targetId,
      })));
    }

    // Run performance audit
    const perfResult = await runLighthouseAudit({ url: `https://${shopDomain}` });
    const storeHealth = calculateStoreHealth(allFindings as any);

    // Update audit
    await prisma.audit.update({
      where: { id: audit.id },
      data: {
        status: "completed",
        completedAt: new Date(),
        overallScore: storeHealth.overall,
        performanceScore: perfResult.combinedScore,
        totalIssues: allFindings.length,
        highCount: allFindings.filter(f => f.severity === "high").length,
        mediumCount: allFindings.filter(f => f.severity === "medium").length,
        lowCount: allFindings.filter(f => f.severity === "low").length,
      },
    });

    // Create findings
    for (const f of allFindings) {
      await prisma.finding.create({
        data: {
          auditId: audit.id,
          ruleId: f.ruleId,
          pageType: f.pageType,
          severity: f.severity,
          title: f.title,
          fixableByAI: f.fixableByAI,
          fixType: f.fixType,
          targetId: f.targetId,
        },
      });
    }

    return { success: true };
  } catch (error) {
    await prisma.audit.update({
      where: { id: audit.id },
      data: { status: "failed", error: String(error) },
    });
    return { success: false, error: String(error) };
  }
};

function StatusBadge({ type, count }: { type: "critical" | "warning" | "success"; count: number }) {
  const styles = {
    critical: { bg: "#FEE2E2", color: "#991B1B", icon: "🔴" },
    warning: { bg: "#FEF3C7", color: "#92400E", icon: "🟡" },
    success: { bg: "#D1FAE5", color: "#065F46", icon: "🟢" },
  };
  const { bg, color, icon } = styles[type];
  const labels = { critical: "Critical", warning: "To Improve", success: "Passed" };

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: 8,
      padding: "8px 16px",
      background: bg,
      borderRadius: 8,
      fontSize: 14,
      fontWeight: 600,
      color,
    }}>
      <span>{icon}</span>
      <span>{count} {labels[type]}</span>
    </div>
  );
}

function IssueCard({
  severity,
  title,
  fixable,
  onFix,
  onDismiss,
}: {
  severity: "high" | "medium" | "low";
  title: string;
  fixable: boolean;
  onFix?: () => void;
  onDismiss?: () => void;
}) {
  const severityColors = {
    high: "#EF4444",
    medium: "#F59E0B",
    low: "#6B7280",
  };

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: 12,
      padding: "16px 20px",
      borderBottom: "1px solid #E5E7EB",
    }}>
      <div style={{
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: severityColors[severity],
        flexShrink: 0,
      }} />
      <span style={{ flex: 1, fontSize: 14 }}>{title}</span>
      <div style={{ display: "flex", gap: 8 }}>
        {fixable ? (
          <s-button variant="primary" onClick={onFix}>Fix with AI</s-button>
        ) : (
          <s-button onClick={onFix}>How to Fix</s-button>
        )}
        <s-button variant="tertiary" onClick={onDismiss}>Dismiss</s-button>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const isScanning = fetcher.state !== "idle";

  const totalIssues = data.critical.length + data.improvements.length + data.minor.length;

  return (
    <s-page heading="Store Health">
      <fetcher.Form method="post">
        <s-button slot="primary-action" type="submit" disabled={isScanning}>
          {isScanning ? "Scanning..." : "Scan Store"}
        </s-button>
      </fetcher.Form>

      {/* Status Summary */}
      {data.hasAudit ? (
        <>
          <div style={{ marginBottom: 24 }}>
            <p style={{ fontSize: 13, color: "#6B7280", margin: "0 0 16px 0" }}>
              Last scan: {data.lastAuditDate}
            </p>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <StatusBadge type="critical" count={data.critical.length} />
              <StatusBadge type="warning" count={data.improvements.length} />
              <StatusBadge type="success" count={data.fixCount} />
            </div>
          </div>

          {/* Critical Issues */}
          {data.critical.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <h2 style={{ fontSize: 16, fontWeight: 600, margin: "0 0 12px 0", color: "#991B1B" }}>
                Fix Now ({data.critical.length})
              </h2>
              <div style={{ border: "1px solid #E5E7EB", borderRadius: 12, overflow: "hidden" }}>
                {data.critical.map((issue) => (
                  <IssueCard
                    key={issue.id}
                    severity="high"
                    title={issue.title}
                    fixable={issue.fixableByAI}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Improvements */}
          {data.improvements.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <h2 style={{ fontSize: 16, fontWeight: 600, margin: "0 0 12px 0", color: "#92400E" }}>
                Improvements ({data.improvements.length})
              </h2>
              <div style={{ border: "1px solid #E5E7EB", borderRadius: 12, overflow: "hidden" }}>
                {data.improvements.slice(0, 5).map((issue) => (
                  <IssueCard
                    key={issue.id}
                    severity="medium"
                    title={issue.title}
                    fixable={issue.fixableByAI}
                  />
                ))}
                {data.improvements.length > 5 && (
                  <div style={{ padding: 16, textAlign: "center", color: "#6B7280", fontSize: 13 }}>
                    +{data.improvements.length - 5} more improvements
                  </div>
                )}
              </div>
            </div>
          )}

          {/* No Issues */}
          {totalIssues === 0 && (
            <div style={{
              textAlign: "center",
              padding: 48,
              background: "#F0FDF4",
              borderRadius: 12,
            }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>🎉</div>
              <h2 style={{ fontSize: 18, fontWeight: 600, margin: "0 0 8px 0", color: "#065F46" }}>
                Your store looks great!
              </h2>
              <p style={{ fontSize: 14, color: "#6B7280", margin: 0 }}>
                No issues found. Run another scan anytime.
              </p>
            </div>
          )}
        </>
      ) : (
        /* No Audit Yet */
        <div style={{
          textAlign: "center",
          padding: 48,
          background: "#F9FAFB",
          borderRadius: 12,
        }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🔍</div>
          <h2 style={{ fontSize: 18, fontWeight: 600, margin: "0 0 8px 0" }}>
            Ready to check your store?
          </h2>
          <p style={{ fontSize: 14, color: "#6B7280", margin: "0 0 16px 0" }}>
            We'll scan your pages and find ways to improve conversions.
          </p>
          <fetcher.Form method="post">
            <s-button variant="primary" type="submit" disabled={isScanning}>
              {isScanning ? "Scanning..." : "Start First Scan"}
            </s-button>
          </fetcher.Form>
        </div>
      )}

      {/* Quick Links */}
      <div style={{
        display: "flex",
        gap: 16,
        marginTop: 24,
        paddingTop: 24,
        borderTop: "1px solid #E5E7EB",
      }}>
        <Link to="/app/history" style={{ fontSize: 13, color: "#2563EB", textDecoration: "none" }}>
          View fix history ({data.fixCount})
        </Link>
        <Link to="/app/settings" style={{ fontSize: 13, color: "#2563EB", textDecoration: "none" }}>
          Settings
        </Link>
      </div>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
