import type { LoaderFunctionArgs, HeadersFunction } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export default function Fixes() {
  return (
    <s-page heading="Fixes">
      <s-button slot="primary-action" variant="secondary">Export log</s-button>

      <s-section>
        <s-paragraph>
          Every change StoreRx has made. Applied fixes can be undone for 30 days.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
