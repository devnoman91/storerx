import type { LoaderFunctionArgs, HeadersFunction, ActionFunctionArgs } from "react-router";
import { useLoaderData, useFetcher } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { getScoreBand } from "../scoring";
import prisma from "../db.server";
import { collectAdminData } from "../collectors/admin";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  // Get or create shop record
  let shop = await prisma.shop.findUnique({ where: { domain: shopDomain } });
  if (!shop) {
    shop = await prisma.shop.create({
      data: { domain: shopDomain },
    });
  }

  // Get latest audit
  const latestAudit = await prisma.audit.findFirst({
    where: { shopId: shop.id, status: "completed" },
    orderBy: { completedAt: "desc" },
    include: {
      findings: {
        where: { status: "open" },
        orderBy: { severity: "asc" },
        take: 5,
      },
    },
  });

  // Get fix count this month
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const fixCount = await prisma.fix.count({
    where: {
      shopId: shop.id,
      status: "applied",
      appliedAt: { gte: monthStart },
    },
  });

  // Calculate days since last audit
  const lastAuditDays = latestAudit?.completedAt
    ? Math.floor((Date.now() - latestAudit.completedAt.getTime()) / (1000 * 60 * 60 * 24))
    : null;

  // Count open findings
  const openFindings = await prisma.finding.count({
    where: {
      audit: { shopId: shop.id },
      status: "open",
    },
  });

  const highPriorityCount = await prisma.finding.count({
    where: {
      audit: { shopId: shop.id },
      status: "open",
      severity: "high",
    },
  });

  // Map findings to prescriptions
  const prescriptions = (latestAudit?.findings || []).map((f) => ({
    id: f.id,
    severity: f.severity as "high" | "medium" | "low",
    title: f.title,
    fixableByAI: f.fixableByAI,
  }));

  return {
    shopDomain,
    hasAudit: !!latestAudit,
    overallScore: latestAudit?.overallScore ?? 0,
    scores: {
      conversion: latestAudit?.conversionScore ?? 0,
      ux: latestAudit?.uxScore ?? 0,
      performance: latestAudit?.performanceScore ?? 0,
      seo: latestAudit?.seoScore ?? 0,
      productPages: latestAudit?.productPagesScore ?? 0,
    },
    trendDirection: "up" as const,
    trendPoints: 0,
    trendPeriod: "last month",
    prescriptionsOpen: openFindings,
    fixesApplied: fixCount,
    fixesPeriod: "this month",
    lastAuditDays,
    highPriorityCount,
    prescriptions,
    isAuditing: false,
    auditProgress: null as null | {
      step: string;
      current: number;
      total: number;
      percent: number;
    },
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  // Get shop record
  let shop = await prisma.shop.findUnique({ where: { domain: shopDomain } });
  if (!shop) {
    shop = await prisma.shop.create({ data: { domain: shopDomain } });
  }

  // Collect shop data from Shopify API
  const shopData = await collectAdminData(admin);

  // Create audit record
  const audit = await prisma.audit.create({
    data: {
      shopId: shop.id,
      status: "running",
      startedAt: new Date(),
    },
  });

  // Import rules and run audit
  const { runRulesWithSummary } = await import("../rules");
  const { collectStorefrontPage, buildAuditPageList } = await import("../collectors/storefront");
  const { runLighthouseAudit } = await import("../collectors/lighthouse");
  const { calculateScore, calculateStoreHealth } = await import("../scoring");

  const allFindings: Array<{
    ruleId: string;
    pageType: string;
    severity: string;
    title: string;
    evidenceType?: string;
    evidenceValue?: string;
    fixableByAI: boolean;
    fixType?: string;
    targetId?: string;
  }> = [];

  try {
    // Build page list
    const pages = buildAuditPageList(
      shopDomain,
      shopData.collections.map((c) => ({ handle: c.handle })),
      shopData.products.map((p) => ({ handle: p.handle }))
    );

    // Scan homepage
    const homepage = await collectStorefrontPage(`https://${shopDomain}`, "homepage", { domain: shopDomain });
    const homepageRules = runRulesWithSummary("homepage", { html: homepage.html, shopData });
    allFindings.push(...homepageRules.findings.map((f) => ({
      ruleId: f.ruleId,
      pageType: "homepage",
      severity: f.severity,
      title: f.title,
      evidenceType: f.evidence?.type,
      evidenceValue: f.evidence?.value,
      fixableByAI: f.fixableByAI,
      fixType: f.fixType,
      targetId: f.targetId,
    })));

    // Scan products
    for (const page of pages.filter((p) => p.type === "product").slice(0, 3)) {
      const prodPage = await collectStorefrontPage(page.url, "product", { domain: shopDomain });
      const prodRules = runRulesWithSummary("product", { html: prodPage.html, shopData });
      allFindings.push(...prodRules.findings.map((f) => ({
        ruleId: f.ruleId,
        pageType: "product",
        severity: f.severity,
        title: f.title,
        evidenceType: f.evidence?.type,
        evidenceValue: f.evidence?.value,
        fixableByAI: f.fixableByAI,
        fixType: f.fixType,
        targetId: f.targetId,
      })));
    }

    // Run performance audit on homepage
    const perfResult = await runLighthouseAudit({ url: `https://${shopDomain}` });

    // Calculate scores
    const storeHealth = calculateStoreHealth(allFindings as any);

    // Update audit with results
    await prisma.audit.update({
      where: { id: audit.id },
      data: {
        status: "completed",
        completedAt: new Date(),
        overallScore: storeHealth.overall,
        conversionScore: storeHealth.categories.find((c) => c.category === "conversion")?.score ?? 0,
        uxScore: storeHealth.categories.find((c) => c.category === "ux")?.score ?? 0,
        performanceScore: perfResult.combinedScore,
        seoScore: storeHealth.categories.find((c) => c.category === "seo")?.score ?? 0,
        productPagesScore: storeHealth.categories.find((c) => c.category === "productPages")?.score ?? 0,
        totalIssues: allFindings.length,
        highCount: allFindings.filter((f) => f.severity === "high").length,
        mediumCount: allFindings.filter((f) => f.severity === "medium").length,
        lowCount: allFindings.filter((f) => f.severity === "low").length,
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
          evidenceType: f.evidenceType,
          evidenceValue: f.evidenceValue,
          fixableByAI: f.fixableByAI,
          fixType: f.fixType,
          targetId: f.targetId,
        },
      });
    }

    return { success: true, auditId: audit.id };
  } catch (error) {
    await prisma.audit.update({
      where: { id: audit.id },
      data: {
        status: "failed",
        error: error instanceof Error ? error.message : "Unknown error",
      },
    });
    return { success: false, error: String(error) };
  }
};

function ScoreRing({ score }: { score: number }) {
  const band = getScoreBand(score);
  const color = band === "critical" ? "#B98900" : band === "warning" ? "#B98900" : "#29845A";
  const degrees = (score / 100) * 360;

  return (
    <div
      style={{
        width: 160,
        height: 160,
        borderRadius: "50%",
        background: `conic-gradient(${color} ${degrees}deg, #E3E3E3 0)`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          width: 128,
          height: 128,
          borderRadius: "50%",
          background: "#fff",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span style={{ fontSize: 44, fontWeight: 700, lineHeight: 1 }}>{score}</span>
        <span style={{ fontSize: 12, color: "#6D7175" }}>out of 100</span>
      </div>
    </div>
  );
}

function ScoreBar({ label, score }: { label: string; score: number }) {
  const band = getScoreBand(score);
  const color = band === "critical" ? "#8E1F0B" : band === "warning" ? "#B98900" : "#29845A";

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "120px 32px 1fr",
        gap: 12,
        alignItems: "center",
        fontSize: 13,
      }}
    >
      <span>{label}</span>
      <strong style={{ textAlign: "right" }}>{score}</strong>
      <div style={{ height: 8, background: "#E3E3E3", borderRadius: 4 }}>
        <div
          style={{
            width: `${score}%`,
            height: 8,
            background: color,
            borderRadius: 4,
          }}
        />
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  suffix,
}: {
  label: string;
  value: number | string;
  suffix?: string;
}) {
  return (
    <s-box padding="base" borderWidth="base" borderRadius="large">
      <div style={{ fontSize: 13, color: "#6D7175", marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700 }}>
        {value}{" "}
        {suffix && (
          <span style={{ fontSize: 13, fontWeight: 400, color: "#6D7175" }}>{suffix}</span>
        )}
      </div>
    </s-box>
  );
}

function PrescriptionRow({
  severity,
  title,
  fixableByAI,
  onView,
  onFix,
}: {
  severity: "high" | "medium" | "low";
  title: string;
  fixableByAI: boolean;
  onView: () => void;
  onFix: () => void;
}) {
  const toneMap = {
    high: "critical",
    medium: "warning",
    low: "info",
  } as const;

  return (
    <div
      style={{
        padding: "12px 20px",
        display: "flex",
        alignItems: "center",
        gap: 12,
        borderBottom: "1px solid #E1E3E5",
        fontSize: 13,
      }}
    >
      <s-badge tone={toneMap[severity]}>
        {severity.charAt(0).toUpperCase() + severity.slice(1)}
      </s-badge>
      <span style={{ flex: 1 }}>{title}</span>
      {fixableByAI ? (
        <s-button variant="primary" onClick={onFix}>
          Fix with AI
        </s-button>
      ) : (
        <s-button onClick={onView}>
          View
        </s-button>
      )}
    </div>
  );
}

export default function Overview() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const isAuditing = fetcher.state !== "idle";

  return (
    <s-page heading="Overview">
      <fetcher.Form method="post">
        <s-button slot="primary-action" type="submit" disabled={isAuditing}>
          {isAuditing ? "Running audit..." : "Run audit"}
        </s-button>
      </fetcher.Form>

      {/* Critical issues banner */}
      {data.highPriorityCount > 0 && (
        <s-banner tone="critical">
          <strong>{data.highPriorityCount} high-priority problems are hurting your conversion.</strong>{" "}
          Fixing them first has the biggest effect on sales.
          <s-button slot="actions" variant="tertiary">
            View
          </s-button>
        </s-banner>
      )}

      {/* Store Health */}
      <s-section heading="Store health">
        <s-box padding="base" borderWidth="base" borderRadius="large">
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              marginBottom: 16,
            }}
          >
            <span style={{ fontSize: 12, color: "#6D7175" }}>
              Last check-up {data.lastAuditDays} days ago
            </span>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "260px 1fr",
              gap: 32,
              alignItems: "center",
            }}
          >
            {/* Score ring + trend */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 12,
              }}
            >
              <ScoreRing score={data.overallScore} />
            </div>

            {/* Category scores */}
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <ScoreBar label="Conversion" score={data.scores.conversion} />
              <ScoreBar label="UX" score={data.scores.ux} />
              <ScoreBar label="Performance" score={data.scores.performance} />
              <ScoreBar label="SEO" score={data.scores.seo} />
              <ScoreBar label="Product pages" score={data.scores.productPages} />
            </div>
          </div>
        </s-box>
      </s-section>

      {/* Metric cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 16,
          marginTop: 16,
        }}
      >
        <MetricCard
          label="Prescriptions"
          value={data.prescriptionsOpen}
          suffix="open"
        />
        <MetricCard
          label="Fixes applied"
          value={data.fixesApplied}
          suffix={data.fixesPeriod}
        />
        <MetricCard
          label="Last audit"
          value={data.lastAuditDays ?? "Never"}
          suffix={data.lastAuditDays !== null ? "days ago" : ""}
        />
      </div>

      {/* Top prescriptions */}
      <s-section heading="Top prescriptions">
        <s-box borderWidth="base" borderRadius="large" padding="none">
          <div
            style={{
              padding: "16px 20px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              borderBottom: "1px solid #E1E3E5",
            }}
          >
            <span style={{ fontSize: 14, fontWeight: 600 }}>Top prescriptions</span>
            <s-link href="/app/prescriptions">View all</s-link>
          </div>
          {data.prescriptions.map((rx) => (
            <PrescriptionRow
              key={rx.id}
              severity={rx.severity}
              title={rx.title}
              fixableByAI={rx.fixableByAI}
              onView={() => {}}
              onFix={() => {}}
            />
          ))}
        </s-box>
      </s-section>

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
