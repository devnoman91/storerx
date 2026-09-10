import type { LoaderFunctionArgs, HeadersFunction, ActionFunctionArgs } from "react-router";
import { useLoaderData, useSearchParams, useFetcher } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useState } from "react";
import { collectAllProductImages } from "../collectors/admin";
import { generateAltText } from "../ai/prompts/alt";

interface ImageIssue {
  id: string;
  imageUrl: string;
  productTitle: string;
  productId: string;
  issue: "missing_alt" | "too_large" | "too_small" | "low_quality";
  issueLabel: string;
  altText?: string;
  fileSize?: number;
  dimensions?: string;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  // Fetch real images from Shopify
  const productImages = await collectAllProductImages(admin, 20);

  const images: ImageIssue[] = [];

  for (const product of productImages) {
    for (const img of product.images) {
      // Check for issues
      const issues: ImageIssue["issue"][] = [];

      if (!img.altText) {
        issues.push("missing_alt");
      }
      if (img.width && img.height && img.width < 600 && img.height < 600) {
        issues.push("too_small");
      }

      // Add image with primary issue
      if (issues.length > 0) {
        const issue = issues[0];
        images.push({
          id: img.id,
          imageUrl: img.url,
          productTitle: product.productTitle,
          productId: product.productId,
          issue,
          issueLabel: issue === "missing_alt" ? "Missing alt text" :
                      issue === "too_small" ? "Image too small" :
                      issue === "too_large" ? "File too large" : "Low quality",
          altText: img.altText || undefined,
          dimensions: img.width && img.height ? `${img.width}x${img.height}` : undefined,
        });
      }
    }
  }

  const stats = {
    missingAlt: images.filter((i) => i.issue === "missing_alt").length,
    tooLarge: images.filter((i) => i.issue === "too_large").length,
    tooSmall: images.filter((i) => i.issue === "too_small").length,
    lowQuality: images.filter((i) => i.issue === "low_quality").length,
  };

  return { images, stats };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const imageId = formData.get("imageId") as string;
  const productTitle = formData.get("productTitle") as string;
  const imageUrl = formData.get("imageUrl") as string;

  // Generate alt text using AI
  const result = await generateAltText("", productTitle);

  // Update image in Shopify
  const mutation = `
    mutation updateProductImage($productId: ID!, $image: ImageInput!) {
      productUpdateMedia(productId: $productId, media: [$image]) {
        product {
          id
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  // Extract product ID from image ID (gid://shopify/ProductImage/123 -> get product)
  // For now just return the generated alt text
  return { success: true, altText: result.data.altText };
};

const issueTone = {
  missing_alt: "warning",
  too_large: "warning",
  too_small: "info",
  low_quality: "critical",
} as const;

function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

export default function Images() {
  const { images, stats } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const filter = searchParams.get("filter") || "all";

  const filtered = images.filter((img) => {
    if (filter === "all") return true;
    if (filter === "missing_alt") return img.issue === "missing_alt";
    if (filter === "too_large") return img.issue === "too_large";
    if (filter === "low_quality") return img.issue === "low_quality";
    return true;
  });

  const toggleSelect = (id: string) => {
    const newSelected = new Set(selected);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelected(newSelected);
  };

  const selectAll = () => {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((i) => i.id)));
    }
  };

  return (
    <s-page heading="Images">
      <s-button slot="primary-action">Generate all alt texts</s-button>

      {/* Filter chips */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <s-button
          variant={filter === "all" ? "primary" : "secondary"}
          onClick={() => setSearchParams({})}
        >
          All ({images.length})
        </s-button>
        <s-button
          variant={filter === "missing_alt" ? "primary" : "secondary"}
          onClick={() => setSearchParams({ filter: "missing_alt" })}
        >
          Missing alt ({stats.missingAlt})
        </s-button>
        <s-button
          variant={filter === "too_large" ? "primary" : "secondary"}
          onClick={() => setSearchParams({ filter: "too_large" })}
        >
          Too large ({stats.tooLarge})
        </s-button>
      </div>

      {/* Bulk actions */}
      {selected.size > 0 && (
        <s-banner tone="info">
          <strong>{selected.size} images selected</strong>
          <s-button slot="actions" variant="primary">
            Generate alt texts
          </s-button>
          <s-button slot="actions" variant="tertiary" onClick={() => setSelected(new Set())}>
            Clear
          </s-button>
        </s-banner>
      )}

      {/* Images table */}
      <s-box borderWidth="base" borderRadius="large" padding="none">
        {/* Header */}
        <div
          style={{
            padding: "12px 20px",
            display: "grid",
            gridTemplateColumns: "40px 60px 1fr 120px 100px 80px",
            gap: 12,
            alignItems: "center",
            borderBottom: "1px solid #E1E3E5",
            fontSize: 12,
            fontWeight: 600,
            color: "#6D7175",
          }}
        >
          <input
            type="checkbox"
            checked={selected.size === filtered.length && filtered.length > 0}
            onChange={selectAll}
          />
          <span>Image</span>
          <span>Product</span>
          <span>Issue</span>
          <span>Size</span>
          <span style={{ textAlign: "right" }}>Action</span>
        </div>

        {/* Rows */}
        {filtered.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: "#6D7175" }}>
            No images with issues found.
          </div>
        ) : (
          filtered.map((img) => (
            <div
              key={img.id}
              style={{
                padding: "12px 20px",
                display: "grid",
                gridTemplateColumns: "40px 60px 1fr 120px 100px 80px",
                gap: 12,
                alignItems: "center",
                borderBottom: "1px solid #E1E3E5",
                fontSize: 13,
              }}
            >
              <input
                type="checkbox"
                checked={selected.has(img.id)}
                onChange={() => toggleSelect(img.id)}
              />
              <div
                style={{
                  width: 48,
                  height: 48,
                  background: "#F6F6F7",
                  borderRadius: 6,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  overflow: "hidden",
                }}
              >
                <img
                  src={img.imageUrl}
                  alt=""
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = "none";
                  }}
                />
              </div>
              <div>
                <div style={{ fontWeight: 500 }}>{img.productTitle}</div>
                {img.altText && (
                  <div style={{ fontSize: 12, color: "#6D7175" }}>{img.altText}</div>
                )}
              </div>
              <s-badge tone={issueTone[img.issue]}>{img.issueLabel}</s-badge>
              <span style={{ color: "#6D7175" }}>
                {img.fileSize ? formatFileSize(img.fileSize) : img.dimensions || "—"}
              </span>
              <div style={{ textAlign: "right" }}>
                {img.issue === "missing_alt" ? (
                  <s-button variant="primary">Fix</s-button>
                ) : (
                  <s-button>View</s-button>
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
