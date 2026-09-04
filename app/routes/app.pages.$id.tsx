import type { LoaderFunctionArgs, HeadersFunction } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return { pageId: params.id };
};

export default function PageDetail() {
  const { pageId } = useLoaderData<typeof loader>();

  return (
    <s-page heading={`Page: ${pageId}`}>
      <s-button slot="primary-action">Rescan page</s-button>

      <s-section>
        <s-paragraph>
          Page detail coming soon.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
