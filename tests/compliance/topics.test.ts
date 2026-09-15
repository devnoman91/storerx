import { describe, it, expect } from "vitest";
import { normalizeComplianceTopic } from "../../app/compliance.server";

describe("normalizeComplianceTopic", () => {
  it("accepts the header form Shopify sends", () => {
    expect(normalizeComplianceTopic("customers/data_request")).toBe("CUSTOMERS_DATA_REQUEST");
    expect(normalizeComplianceTopic("customers/redact")).toBe("CUSTOMERS_REDACT");
    expect(normalizeComplianceTopic("shop/redact")).toBe("SHOP_REDACT");
  });

  it("accepts the enum form the Shopify library returns", () => {
    expect(normalizeComplianceTopic("SHOP_REDACT")).toBe("SHOP_REDACT");
  });

  it("rejects topics that are not compliance topics", () => {
    expect(normalizeComplianceTopic("app/uninstalled")).toBeNull();
    expect(normalizeComplianceTopic("products/update")).toBeNull();
    expect(normalizeComplianceTopic("")).toBeNull();
  });
});
