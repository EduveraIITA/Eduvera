import type { AttentionCounts, AttentionModule } from "./api";
import "./attention.css";

type AttentionBadgeVariant = "module" | "nav";

export function attentionCount(counts: AttentionCounts | null | undefined) {
  if (!counts) return 0;
  return Math.max(0, counts.total, counts.urgent, counts.exceptions, counts.action_required, counts.new);
}

/**
 * A single outstanding item has one unambiguous destination. With more than
 * one item, keep people in the owning module so they can review the full set.
 */
export function attentionDestination(module: AttentionModule | null | undefined, fallback: string) {
  if (!module) return fallback;
  if (attentionCount(module) === 1 && module.first_item_href) return module.first_item_href;
  return module.href || fallback;
}

export function combineAttentionCounts(...values: Array<AttentionCounts | null | undefined>): AttentionCounts | undefined {
  const counts = values.filter((value): value is AttentionCounts => Boolean(value));
  if (!counts.length) return undefined;
  const priorities = ["urgent", "high", "normal"] as const;
  return {
    total: counts.reduce((sum, value) => sum + value.total, 0),
    new: counts.reduce((sum, value) => sum + value.new, 0),
    action_required: counts.reduce((sum, value) => sum + value.action_required, 0),
    exceptions: counts.reduce((sum, value) => sum + value.exceptions, 0),
    urgent: counts.reduce((sum, value) => sum + value.urgent, 0),
    high: counts.reduce((sum, value) => sum + (value.high ?? 0), 0),
    normal: counts.reduce((sum, value) => sum + (value.normal ?? 0), 0),
    highest_priority: priorities.find((priority) => counts.some((value) => value.highest_priority === priority)) ?? null,
  };
}

export function attentionLabel(counts: AttentionCounts | null | undefined, subject = "items") {
  if (!counts || attentionCount(counts) === 0) return "";
  if (counts.urgent > 0) return `${counts.urgent} urgent ${subject}`;
  if (counts.exceptions > 0) return `${counts.exceptions} ${counts.exceptions === 1 ? "exception" : "exceptions"}`;
  if (counts.action_required > 0) return `${counts.action_required} ${counts.action_required === 1 ? "action" : "actions"} required`;
  if (counts.new > 0) return `${counts.new} new ${subject}`;
  const total = attentionCount(counts);
  return `${total} ${subject} need attention`;
}

function attentionTone(counts: AttentionCounts) {
  if (counts.urgent > 0 || counts.exceptions > 0) return "exception";
  if (counts.action_required > 0) return "action";
  return "new";
}

function attentionDisplayCount(counts: AttentionCounts) {
  if (counts.urgent > 0) return counts.urgent;
  if (counts.exceptions > 0) return counts.exceptions;
  if (counts.action_required > 0) return counts.action_required;
  if (counts.new > 0) return counts.new;
  return counts.total;
}

export function AttentionBadge({ counts, subject = "items", variant = "module" }: {
  counts: AttentionCounts | null | undefined;
  subject?: string;
  variant?: AttentionBadgeVariant;
}) {
  const total = attentionCount(counts);
  if (!counts || total === 0) return null;
  const label = attentionLabel(counts, subject);
  const tone = attentionTone(counts);
  const count = attentionDisplayCount(counts);
  const counted = variant === "module" && tone !== "new";

  return <span
    className={`attention-indicator attention-indicator--${variant} attention-indicator--${tone}${counted ? " attention-indicator--counted" : ""}`}
    aria-label={label}
    title={label}
  >
    {counted ? <span aria-hidden="true">{count > 99 ? "99+" : count}</span> : null}
  </span>;
}

export function AttentionUnavailableBadge({ variant = "nav" }: { variant?: AttentionBadgeVariant }) {
  return <span
    className={`attention-indicator attention-indicator--${variant} attention-indicator--unavailable`}
    aria-hidden="true"
  />;
}
