import { describe, expect, it } from "vitest";
import { sortRequestItems, summarizeRequestItems } from "../src/requests/requests.service.js";
import type { RequestInboxItem } from "../src/requests/requests.types.js";

function item(id: string, priority: RequestInboxItem["priority"], dueAt: string, category: RequestInboxItem["category"]): RequestInboxItem {
  return {
    id,
    kind: id,
    category,
    priority,
    title: id,
    detail: "",
    status_label: "Pending",
    action_label: "Review",
    href: "/",
    source_id: id,
    subject_label: null,
    occurs_at: null,
    due_at: dueAt,
    created_at: null,
  };
}

describe("request inbox projection", () => {
  it("stacks urgent work first and orders equal priorities by deadline", () => {
    const items = sortRequestItems([
      item("normal", "normal", "2026-10-10T12:00:00Z", "governance"),
      item("later-urgent", "urgent", "2026-10-10T12:00:00Z", "transport"),
      item("first-urgent", "urgent", "2026-10-09T12:00:00Z", "attendance"),
      item("high", "high", "2026-10-08T12:00:00Z", "leave"),
    ]);
    expect(items.map((entry) => entry.id)).toEqual(["first-urgent", "later-urgent", "high", "normal"]);
  });

  it("returns compact priority and category counts", () => {
    expect(summarizeRequestItems([
      item("one", "urgent", "2026-10-09T12:00:00Z", "transport"),
      item("two", "high", "2026-10-10T12:00:00Z", "transport"),
      item("three", "normal", "2026-10-11T12:00:00Z", "governance"),
    ])).toEqual({ total: 3, urgent: 1, high: 1, normal: 1, categories: { transport: 2, governance: 1 } });
  });
});
