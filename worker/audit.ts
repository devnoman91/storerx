/**
 * Audit Worker (BullMQ)
 *
 * Background job that runs store audits.
 * Never runs inside HTTP request handlers.
 *
 * Pages sampled per audit (not full crawl):
 * - Homepage
 * - 3 collections (largest by product count)
 * - 5 products (top sellers from last 30 days; fallback: newest)
 * - Cart
 * - Checkout settings (Admin API, not crawled)
 */

export interface AuditJobData {
  shopDomain: string;
  accessToken: string;
  /** Pages to audit - if not provided, uses default sample */
  pages?: { type: string; url: string }[];
}

export interface AuditJobResult {
  shopDomain: string;
  findings: unknown[]; // Finding[]
  scores: unknown; // StoreHealthScore
  completedAt: Date;
}

/**
 * Process an audit job
 *
 * Steps:
 * 1. Collect Admin data (GraphQL)
 * 2. Determine pages to scan
 * 3. Collect storefront pages (Playwright)
 * 4. Run Lighthouse on each page
 * 5. Run rule engine on each page
 * 6. Calculate scores
 * 7. Generate AI explanations
 * 8. Store results
 */
export async function processAuditJob(data: AuditJobData): Promise<AuditJobResult> {
  const { shopDomain } = data;

  // TODO: Implement full audit pipeline
  // 1. collectAdminData()
  // 2. fetchTopSellingProducts() / fetchLargestCollections()
  // 3. collectAuditPages()
  // 4. runLighthouseAudit() for each page
  // 5. Run all rules
  // 6. calculateStoreHealth()
  // 7. generate() explanations
  // 8. Store in database

  throw new Error("Audit worker not implemented");
}

/**
 * Get audit progress
 */
export interface AuditProgress {
  status: "pending" | "running" | "completed" | "failed";
  currentStep: string;
  stepsCompleted: number;
  totalSteps: number;
}

export function getAuditProgress(jobId: string): AuditProgress {
  // TODO: Get progress from Redis/BullMQ
  return {
    status: "pending",
    currentStep: "",
    stepsCompleted: 0,
    totalSteps: 5,
  };
}
