import { ArrowRight, DoorOpen } from "lucide-react";
import type { Visitor, VisitorCounts } from "./api";

export function GateVisitorQueueShortcut({ visitors, counts, hindi, busy, onOpen }: {
  visitors: Visitor[];
  counts?: VisitorCounts;
  hindi: boolean;
  busy: boolean;
  onOpen: () => void;
}) {
  const inside = counts?.inside ?? visitors.filter((visitor) => visitor.state === "inside").length;
  const approved = counts?.approved ?? visitors.filter((visitor) => visitor.state === "approved").length;
  const pending = counts?.pending ?? visitors.filter((visitor) => visitor.state === "pending").length;
  if (!inside && !approved && !pending) return null;
  const summary = [
    inside ? `${inside} ${hindi ? "अंदर" : "inside"}` : null,
    approved ? `${approved} ${hindi ? "स्वीकृत" : "approved"}` : null,
    pending ? `${pending} ${hindi ? "अनुमति के इंतज़ार में" : "awaiting approval"}` : null,
  ].filter(Boolean).join(" · ");

  return <button type="button" className="gate-visitor-queue" disabled={busy} onClick={onOpen}>
    <DoorOpen size={20} aria-hidden="true" />
    <span><strong>{hindi ? "गेट पर आगंतुक" : "Visitors at the gate"}</strong><small>{summary}</small></span>
    <ArrowRight size={17} aria-hidden="true" />
  </button>;
}
