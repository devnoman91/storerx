import type { LoaderFunctionArgs, HeadersFunction } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";

interface Plan {
  id: string;
  name: string;
  price: number;
  priceLabel: string;
  features: string[];
  recommended?: boolean;
}

interface UsageData {
  aiGenerations: number;
  aiGenerationsLimit: number;
  auditsThisMonth: number;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  // TODO: Fetch current plan and usage from database
  const currentPlan = "free";

  const plans: Plan[] = [
    {
      id: "free",
      name: "Free",
      price: 0,
      priceLabel: "Free",
      features: [
        "1 audit per month",
        "5 AI recommendations",
        "Alt text for 20 images",
        "Basic prescriptions",
      ],
    },
    {
      id: "starter",
      name: "Starter",
      price: 19,
      priceLabel: "$19/mo",
      features: [
        "Weekly audits",
        "Unlimited recommendations",
        "Product copy fixes",
        "Image compression",
        "Email summaries",
      ],
      recommended: true,
    },
    {
      id: "growth",
      name: "Growth",
      price: 49,
      priceLabel: "$49/mo",
      features: [
        "Unlimited audits",
        "All AI fixes",
        "Full-catalog image scan",
        "Background removal",
        "Performance insights",
        "Priority support",
      ],
    },
    {
      id: "pro",
      name: "Pro",
      price: 99,
      priceLabel: "$99/mo",
      features: [
        "Everything in Growth",
        "Multi-store support",
        "Advanced analytics",
        "Custom rules",
        "API access",
        "Dedicated support",
      ],
    },
  ];

  const usage: UsageData = {
    aiGenerations: 3,
    aiGenerationsLimit: 5,
    auditsThisMonth: 1,
  };

  return { plans, currentPlan, usage };
};

function PlanCard({
  plan,
  isCurrent,
}: {
  plan: Plan;
  isCurrent: boolean;
}) {
  const borderStyle = isCurrent || plan.recommended ? "2px solid #0B4F8A" : "1px solid #E1E3E5";
  return (
    <div
      style={{
        padding: 16,
        border: borderStyle,
        borderRadius: 12,
        position: "relative",
      }}
    >
      {plan.recommended && !isCurrent && (
        <div
          style={{
            position: "absolute",
            top: -10,
            left: "50%",
            transform: "translateX(-50%)",
            background: "#0B4F8A",
            color: "#fff",
            padding: "2px 12px",
            borderRadius: 12,
            fontSize: 11,
            fontWeight: 600,
          }}
        >
          Recommended
        </div>
      )}

      <div style={{ textAlign: "center", marginBottom: 16 }}>
        <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 4 }}>{plan.name}</div>
        <div style={{ fontSize: 28, fontWeight: 700 }}>{plan.priceLabel}</div>
      </div>

      <ul
        style={{
          listStyle: "none",
          padding: 0,
          margin: "0 0 16px 0",
          fontSize: 13,
        }}
      >
        {plan.features.map((feature, i) => (
          <li
            key={i}
            style={{
              padding: "6px 0",
              borderBottom: i < plan.features.length - 1 ? "1px solid #E1E3E5" : undefined,
            }}
          >
            ✓ {feature}
          </li>
        ))}
      </ul>

      <div style={{ textAlign: "center" }}>
        {isCurrent ? (
          <s-badge tone="success">Current plan</s-badge>
        ) : plan.price === 0 ? (
          <s-button variant="secondary" disabled>
            Downgrade
          </s-button>
        ) : (
          <s-button variant={plan.recommended ? "primary" : "secondary"}>
            Upgrade
          </s-button>
        )}
      </div>
    </div>
  );
}

export default function Plans() {
  const { plans, currentPlan, usage } = useLoaderData<typeof loader>();

  const usagePercent = Math.round((usage.aiGenerations / usage.aiGenerationsLimit) * 100);

  return (
    <s-page heading="Plans">
      <p style={{ margin: "0 0 24px 0", fontSize: 13, color: "#6D7175" }}>
        Billed monthly through your Shopify invoice. Change or cancel any time.
      </p>

      {/* Usage meter */}
      <div style={{ padding: 16, border: "1px solid #E1E3E5", borderRadius: 12, marginBottom: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 500 }}>AI generations this month</span>
          <span style={{ fontSize: 13, color: "#6D7175" }}>
            {usage.aiGenerations} / {usage.aiGenerationsLimit}
          </span>
        </div>
        <div
          style={{
            height: 8,
            background: "#E3E3E3",
            borderRadius: 4,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${usagePercent}%`,
              height: "100%",
              background: usagePercent > 80 ? "#B98900" : "#0B4F8A",
              borderRadius: 4,
            }}
          />
        </div>
      </div>

      {/* Plan cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 16,
        }}
      >
        {plans.map((plan) => (
          <PlanCard key={plan.id} plan={plan} isCurrent={currentPlan === plan.id} />
        ))}
      </div>

      {/* Footer */}
      <div
        style={{
          textAlign: "center",
          fontSize: 13,
          color: "#6D7175",
          paddingTop: 24,
        }}
      >
        Questions about billing? <s-link href="mailto:support@storerx.app">Contact us</s-link>
      </div>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
