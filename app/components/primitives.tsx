/**
 * Small building blocks composed from Polaris, plus the one thing Polaris
 * does not provide: a score dial.
 *
 * These exist so the same idea is built the same way everywhere — a state with
 * nothing in it, a callout, a number with a label — instead of each screen
 * inventing its own stack of boxes.
 */

import { useState, type ReactNode } from "react";
import { NEUTRAL_BAR, scoreBand, withAlpha, type IconName, type Tone } from "./tokens";

/**
 * Circular score dial.
 *
 * Drawn by hand because Polaris has no gauge, and a bare number does not tell
 * a merchant whether 62 is good. The arc is the only colour StoreRx sets
 * itself (see tokens.ts); the track reuses it at low opacity so the dial needs
 * no background colour of its own and sits correctly on light or dark.
 *
 * `null` means nothing has been measured, which is drawn as an empty dial —
 * never as a zero.
 */
export function ScoreDial({
  score,
  size = 132,
  label,
}: {
  score: number | null;
  size?: number;
  label?: string;
}) {
  const stroke = Math.round(size * 0.09);
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const measured = typeof score === "number";
  const band = measured ? scoreBand(score) : null;
  const offset = measured ? circumference * (1 - Math.max(0, Math.min(100, score)) / 100) : circumference;

  return (
    <div
      role="img"
      aria-label={measured ? `Store health score ${score} out of 100` : "Store health not measured yet"}
      style={{ position: "relative", inlineSize: size, blockSize: size, flexShrink: 0 }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={band?.colour ?? "currentColor"}
            strokeOpacity={0.15}
            strokeWidth={stroke}
          />
          {measured && (
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={band!.colour}
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              style={{ transition: "stroke-dashoffset 600ms ease" }}
            />
          )}
        </g>
      </svg>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 2,
        }}
      >
        <span
          style={{
            fontSize: Math.round(size * 0.3),
            fontWeight: 650,
            lineHeight: 1,
            fontVariantNumeric: "tabular-nums",
            color: band?.colour ?? "inherit",
          }}
        >
          {measured ? score : "—"}
        </span>
        {label && <s-text color="subdued">{label}</s-text>}
      </div>
    </div>
  );
}

/**
 * A thin horizontal meter. The track is the fill colour at low alpha rather
 * than a dimmed parent, so the fill keeps its full strength.
 */
export function Bar({ percent, colour }: { percent: number; colour: string }) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div
      style={{
        blockSize: 6,
        borderRadius: 999,
        background: withAlpha(colour, 0.16),
        overflow: "hidden",
      }}
      aria-hidden="true"
    >
      <div
        style={{
          blockSize: "100%",
          inlineSize: `${clamped}%`,
          background: colour,
          borderRadius: 999,
          transition: "inline-size 600ms ease",
        }}
      />
    </div>
  );
}

/**
 * A category's score. Same colour language as the dial, so a category reads
 * as part of the same measurement as the overall score.
 */
export function ScoreBar({ score }: { score: number }) {
  return <Bar percent={score} colour={scoreBand(score).colour} />;
}

/**
 * How much of an allowance is left. Deliberately not colour-banded: a plan
 * that is 60% used is not "unhealthy", and colouring it red would say so.
 */
export function UsageBar({ used, limit }: { used: number; limit: number }) {
  return <Bar percent={limit === 0 ? 100 : (used / limit) * 100} colour={NEUTRAL_BAR} />;
}

/**
 * A short, tinted aside — used for the line that says who makes the change.
 * Quieter than a banner, which is reserved for things that just happened.
 */
export function Callout({
  icon,
  children,
  tone = "neutral",
}: {
  icon: IconName;
  children: ReactNode;
  tone?: Tone;
}) {
  return (
    <s-box padding="small" background="subdued" borderRadius="base">
      <s-stack direction="inline" gap="small-300" alignItems="center">
        <s-icon type={icon} tone={tone} size="base" />
        <s-text color="subdued">{children}</s-text>
      </s-stack>
    </s-box>
  );
}

/**
 * Nothing here, something went wrong, or still working — the same shape every
 * time, so these never read as a broken screen.
 */
export function StateCard({
  icon,
  tone = "neutral",
  heading,
  children,
  action,
  loading,
}: {
  icon?: IconName;
  tone?: Tone;
  heading: string;
  children?: ReactNode;
  action?: ReactNode;
  loading?: boolean;
}) {
  return (
    <s-box padding="large-100" background="subdued" borderRadius="base">
      <s-stack direction="block" gap="small" alignItems="center">
        {loading ? (
          <s-spinner size="base" accessibilityLabel={heading} />
        ) : (
          icon && <s-icon type={icon} tone={tone} size="base" />
        )}
        <s-heading>{heading}</s-heading>
        {children && (
          <s-paragraph color="subdued">{children}</s-paragraph>
        )}
        {action}
      </s-stack>
    </s-box>
  );
}

/**
 * Progressive disclosure for a long list: the first few, then the rest on
 * request. Keeps the dashboard readable on a store with forty issues without
 * hiding anything behind a second page.
 */
export function ShowMore<T>({
  items,
  initial = 4,
  render,
  moreLabel = (n) => `Show ${n} more`,
  lessLabel = "Show fewer",
}: {
  items: T[];
  initial?: number;
  render: (item: T) => ReactNode;
  moreLabel?: (remaining: number) => string;
  lessLabel?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? items : items.slice(0, initial);
  const remaining = items.length - shown.length;

  return (
    <s-stack direction="block" gap="small">
      {shown.map(render)}
      {(remaining > 0 || expanded) && (
        <s-button
          variant="tertiary"
          icon={expanded ? "chevron-up" : "chevron-down"}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? lessLabel : moreLabel(remaining)}
        </s-button>
      )}
    </s-stack>
  );
}
