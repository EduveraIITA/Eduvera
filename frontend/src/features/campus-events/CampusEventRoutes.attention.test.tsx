import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  OperationsEventAttentionGate,
  operationsEventAttentionResolution,
} from "./CampusEventRoutes";

vi.mock("../attention/AttentionOpenAcknowledgement", () => ({
  AttentionOpenAcknowledgement: () => <output data-testid="event-attention-ack" />,
}));

afterEach(cleanup);

describe("operations event cancellation attention", () => {
  const event = { status: "cancelled" as const, revision: 4 };
  const target = {
    notificationId: "10000000-0000-4000-a000-000000000001",
    focus: "status",
    eventRevision: 4,
  };

  it("acknowledges only the exact loaded cancellation revision", () => {
    expect(operationsEventAttentionResolution(event, target)).toBe("exact");
    render(<OperationsEventAttentionGate event={event} target={target} />);
    expect(screen.getByTestId("event-attention-ack")).toBeInTheDocument();
  });

  it.each([
    [{ status: "published" as const, revision: 4 }, target],
    [event, { ...target, eventRevision: 3 }],
    [event, { ...target, focus: "duty" }],
  ])("fails closed for a stale or mismatched target", (loadedEvent, requestedTarget) => {
    expect(operationsEventAttentionResolution(loadedEvent, requestedTarget)).toBe("stale");
    render(<OperationsEventAttentionGate event={loadedEvent} target={requestedTarget} />);
    expect(screen.queryByTestId("event-attention-ack")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("not marked as opened");
  });

  it("does not treat normal event navigation as an attention target", () => {
    expect(operationsEventAttentionResolution(event, {
      notificationId: null,
      focus: null,
      eventRevision: null,
    })).toBe("none");
  });
});
