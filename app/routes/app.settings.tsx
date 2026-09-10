import type { LoaderFunctionArgs, ActionFunctionArgs, HeadersFunction } from "react-router";
import { useLoaderData, Form, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useState, useEffect } from "react";

interface SettingsData {
  brandVoice: string;
  auditSchedule: "weekly" | "monthly" | "manual";
  emailSummary: boolean;
  excludedPaths: string;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  // TODO: Fetch from database
  const settings: SettingsData = {
    brandVoice: "",
    auditSchedule: "weekly",
    emailSummary: true,
    excludedPaths: "",
  };

  return { settings };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.admin(request);

  const formData = await request.formData();
  const brandVoice = formData.get("brandVoice") as string;
  const auditSchedule = formData.get("auditSchedule") as string;
  const emailSummary = formData.get("emailSummary") === "on";
  const excludedPaths = formData.get("excludedPaths") as string;

  // TODO: Save to database
  console.log("Saving settings:", { brandVoice, auditSchedule, emailSummary, excludedPaths });

  return { success: true };
};

export default function Settings() {
  const { settings } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const [brandVoice, setBrandVoice] = useState(settings.brandVoice);
  const [auditSchedule, setAuditSchedule] = useState(settings.auditSchedule);
  const [emailSummary, setEmailSummary] = useState(settings.emailSummary);
  const [excludedPaths, setExcludedPaths] = useState(settings.excludedPaths);
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    const changed =
      brandVoice !== settings.brandVoice ||
      auditSchedule !== settings.auditSchedule ||
      emailSummary !== settings.emailSummary ||
      excludedPaths !== settings.excludedPaths;
    setIsDirty(changed);
  }, [brandVoice, auditSchedule, emailSummary, excludedPaths, settings]);

  return (
    <Form method="post">
      <s-page heading="Settings">
        {isDirty && (
          <div
            slot="primary-action"
            style={{ display: "flex", gap: 8 }}
          >
            <s-button
              variant="secondary"
              type="button"
              onClick={() => {
                setBrandVoice(settings.brandVoice);
                setAuditSchedule(settings.auditSchedule);
                setEmailSummary(settings.emailSummary);
                setExcludedPaths(settings.excludedPaths);
              }}
            >
              Discard
            </s-button>
            <s-button variant="primary" type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving..." : "Save"}
            </s-button>
          </div>
        )}

        <s-section heading="Brand voice">
          <p style={{ margin: "0 0 12px 0", fontSize: 13, color: "#6D7175" }}>
            Paste two or three paragraphs of copy you like. AI fixes will match this tone.
          </p>
          <textarea
            name="brandVoice"
            value={brandVoice}
            onChange={(e) => setBrandVoice(e.target.value)}
            placeholder="Paste sample copy from your website, marketing emails, or product descriptions..."
            style={{
              width: "100%",
              minHeight: 120,
              padding: 12,
              border: "1px solid #C9CCCF",
              borderRadius: 8,
              fontSize: 13,
              fontFamily: "inherit",
              resize: "vertical",
            }}
          />
        </s-section>

        <s-section heading="Audit schedule">
          <p style={{ margin: "0 0 12px 0", fontSize: 13, color: "#6D7175" }}>
            How often StoreRx re-checks your store automatically.
          </p>
          <select
            name="auditSchedule"
            value={auditSchedule}
            onChange={(e) => setAuditSchedule(e.target.value as SettingsData["auditSchedule"])}
            style={{
              width: 200,
              padding: "8px 12px",
              border: "1px solid #C9CCCF",
              borderRadius: 8,
              fontSize: 13,
              fontFamily: "inherit",
              background: "#fff",
            }}
          >
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="manual">Manual only</option>
          </select>
        </s-section>

        <s-section heading="Email summary">
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              name="emailSummary"
              checked={emailSummary}
              onChange={(e) => setEmailSummary(e.target.checked)}
              style={{ width: 18, height: 18 }}
            />
            Send a summary email after every scheduled audit
          </label>
        </s-section>

        <s-section heading="Excluded pages">
          <p style={{ margin: "0 0 12px 0", fontSize: 13, color: "#6D7175" }}>
            Pages StoreRx should skip, one URL path per line (e.g., /pages/coming-soon).
          </p>
          <textarea
            name="excludedPaths"
            value={excludedPaths}
            onChange={(e) => setExcludedPaths(e.target.value)}
            placeholder="/pages/coming-soon&#10;/collections/archive"
            style={{
              width: "100%",
              minHeight: 80,
              padding: 12,
              border: "1px solid #C9CCCF",
              borderRadius: 8,
              fontSize: 13,
              fontFamily: "monospace",
              resize: "vertical",
            }}
          />
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
    </Form>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
