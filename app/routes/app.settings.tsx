import type { LoaderFunctionArgs, HeadersFunction } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export default function Settings() {
  return (
    <s-page heading="Settings">
      <s-section heading="Brand voice">
        <s-paragraph>
          Paste two or three paragraphs of copy you like. AI fixes will match this tone.
        </s-paragraph>
      </s-section>

      <s-section heading="Audit schedule">
        <s-paragraph>
          How often StoreRx re-checks your store automatically.
        </s-paragraph>
      </s-section>

      <s-section heading="Email">
        <s-paragraph>
          A short summary after every scheduled audit.
        </s-paragraph>
      </s-section>

      <s-section heading="Excluded pages">
        <s-paragraph>
          Pages StoreRx should skip, one URL path per line.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
