import "reflect-metadata";
import { describe, expect, it } from "vitest";
import { mergeWorkItems } from "../src/workspace/workspace.service.js";
import type { WorkspaceWorkRecord } from "../src/workspace/workspace.contracts.js";

const item: WorkspaceWorkRecord = { id: "core-message", kind: "request", urgency: "normal", title: "Review staff leave", href: "/work/staff-leave?request=one",
  action_label: "Review", source: { domain: "staff_operations", kind: "staff_leave_request", id: "one", action: "decide", revision: 1 }, core_trace: { message_ids: ["core-message"] } };
describe("source and action based Work merge", () => {
  it("retains the Core trace across different titles and equivalent source link spellings", () => {
    const native: WorkspaceWorkRecord = { id: "domain:leave", title: "Meera · Personal leave", href: "/work/staff-leave?school=campus&request=one", kind: "request", urgency: "normal", action_label: "Review", source: item.source! };
    expect(mergeWorkItems([item], [native], "live:campus")).toEqual([item]);
  });
  it("does not collapse a different source, action, or opaque item merely because its title and link match", () => {
    const otherSource = { ...item, id: "other-source", source: { ...item.source!, id: "two" } };
    const waiting = { ...item, id: "waiting", direction: "waiting" as const, source: { ...item.source!, action: "await_decision" } };
    const opaque = { kind: item.kind, urgency: item.urgency, title: item.title, href: item.href, action_label: item.action_label };
    expect(mergeWorkItems([item], [otherSource, waiting, { ...opaque, id: "opaque-a" }, { ...opaque, id: "opaque-b" }])).toHaveLength(5);
  });
});
