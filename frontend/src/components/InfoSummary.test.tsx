import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InfoSummary } from "./InfoSummary";

afterEach(cleanup);

describe("informational disclosures", () => {
  it("keeps a labelled native summary and opens help without a nested button", async () => {
    const user = userEvent.setup();
    const { container } = render(<details><InfoSummary>File details</InfoSummary><p>Supported files and limits.</p></details>);
    const summary = container.querySelector("summary")!;
    expect(summary).toHaveAccessibleName("File details");
    expect(summary.querySelector("button")).toBeNull();
    expect(summary.querySelector(".thatcampus-info-summary__icon")).toHaveAttribute("aria-hidden", "true");
    expect(summary.querySelector("svg")).toHaveAttribute("focusable", "false");
    expect(container.querySelector("details")).not.toHaveAttribute("open");
    await user.tab();
    expect(summary).toHaveFocus();
    await user.click(summary);
    expect(container.querySelector("details")).toHaveAttribute("open");
    expect(screen.getByText("Supported files and limits.")).toBeVisible();
    await user.click(summary);
    expect(container.querySelector("details")).not.toHaveAttribute("open");
  });

  it("preserves caller labels, handlers and classes without replacing details state", async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    const { container } = render(<details open><InfoSummary className="local-help" aria-label="Attendance counting rules" onClick={onClick}>How it works</InfoSummary><p>Missing records are not absences.</p></details>);
    const summary = container.querySelector("summary")!;
    expect(summary).toHaveClass("thatcampus-info-summary", "local-help");
    expect(summary).toHaveAccessibleName("Attendance counting rules");
    await user.click(summary);
    expect(onClick).toHaveBeenCalledOnce();
    expect(container.querySelector("details")).not.toHaveAttribute("open");
  });
});
