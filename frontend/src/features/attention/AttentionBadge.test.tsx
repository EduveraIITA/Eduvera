import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AttentionBadge, combineAttentionCounts } from "./AttentionBadge";

afterEach(cleanup);

describe("AttentionBadge", () => {
  it("uses an accessible action label and a compact visible count", () => {
    render(<AttentionBadge counts={{ total: 3, new: 0, action_required: 3, exceptions: 0, urgent: 0 }} subject="requests" />);
    expect(screen.getByLabelText("3 actions required")).toHaveTextContent("3");
  });

  it("shows new information as a dot rather than warning colour or decorative copy", () => {
    const view = render(<AttentionBadge counts={{ total: 2, new: 2, action_required: 0, exceptions: 0, urgent: 0 }} subject="notices" />);
    expect(screen.getByLabelText("2 new notices")).toHaveTextContent("");
    expect(view.container.querySelector(".attention-indicator--new")).toBeInTheDocument();
    expect(view.container.querySelector(".attention-indicator--exception")).not.toBeInTheDocument();
  });

  it("renders nothing when the module has no attention", () => {
    const view = render(<AttentionBadge counts={{ total: 0, new: 0, action_required: 0, exceptions: 0, urgent: 0 }} />);
    expect(view.container).toBeEmptyDOMElement();
  });

  it("combines distinct owning-module queues for one navigation destination", () => {
    expect(combineAttentionCounts(
      { total: 2, new: 0, action_required: 2, exceptions: 0, urgent: 0, high: 1, normal: 1, highest_priority: "high" },
      { total: 1, new: 0, action_required: 1, exceptions: 1, urgent: 1, high: 0, normal: 0, highest_priority: "urgent" },
    )).toEqual({ total: 3, new: 0, action_required: 3, exceptions: 1, urgent: 1, high: 1, normal: 1, highest_priority: "urgent" });
  });
});
