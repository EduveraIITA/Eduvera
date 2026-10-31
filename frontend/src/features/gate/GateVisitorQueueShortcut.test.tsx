import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { GateVisitorQueueShortcut } from "./GateVisitorQueueShortcut";
import type { Visitor } from "./api";

afterEach(cleanup);
const visitor = (state: Visitor["state"], id = state): Visitor => ({ id, state, school_id: "school", name: id, purpose: "Visit", revision: 1 });

it.each([{ visitors: [] }, { visitors: [visitor("out"), visitor("denied"), visitor("expired")] }])("adds no home shortcut when there are no active visitors", ({ visitors }) => {
  render(<GateVisitorQueueShortcut visitors={visitors} hindi={false} busy={false} onOpen={vi.fn()} />);
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

it("counts only current visitor states and opens from the native keyboard button without performing a movement", async () => {
  const open = vi.fn();
  render(<GateVisitorQueueShortcut visitors={[visitor("inside"), visitor("approved"), visitor("pending"), visitor("out")]} hindi={false} busy={false} onOpen={open} />);
  const shortcut = screen.getByRole("button", { name: "Visitors at the gate 1 inside · 1 approved · 1 awaiting approval" });
  expect(shortcut.tagName).toBe("BUTTON");
  const user = userEvent.setup();await user.tab();expect(shortcut).toHaveFocus();await user.keyboard("{Enter}");
  expect(open).toHaveBeenCalledOnce();
});

it("retains Hindi labels and disables navigation while a movement is saving", async () => {
  const open = vi.fn();render(<GateVisitorQueueShortcut visitors={[visitor("inside"), visitor("pending")]} hindi busy onOpen={open} />);
  const shortcut = screen.getByRole("button", { name: "गेट पर आगंतुक 1 अंदर · 1 अनुमति के इंतज़ार में" });
  expect(shortcut).toBeDisabled();await userEvent.setup().click(shortcut);expect(open).not.toHaveBeenCalled();
});

it("uses true active totals even when this visitor page contains only closed visits", () => {
  render(<GateVisitorQueueShortcut visitors={[visitor("out")]} counts={{ all: 130, active: 30, inside: 11, approved: 12, pending: 7, closed: 100 }} hindi={false} busy={false} onOpen={vi.fn()} />);
  expect(screen.getByRole("button", { name: "Visitors at the gate 11 inside · 12 approved · 7 awaiting approval" })).toBeVisible();
});
