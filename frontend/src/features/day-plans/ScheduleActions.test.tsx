import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScheduleActions } from "./ScheduleActions";

afterEach(cleanup);

describe("schedule actions", () => {
  it("keeps a Safari button tap alive when focus leaves the summary without a new focus target", async () => {
    const prepare = vi.fn();
    const { container } = render(<ScheduleActions><button onClick={prepare}>Prepare changes</button></ScheduleActions>);
    const summary = screen.getByLabelText("Schedule actions");
    await userEvent.click(summary);
    const button = screen.getByRole("button", { name: "Prepare changes" });
    fireEvent.pointerDown(button);
    fireEvent.blur(summary, { relatedTarget: null });
    expect(container.querySelector("details")).toHaveAttribute("open");
    fireEvent.click(button);
    expect(prepare).toHaveBeenCalledOnce();
  });

  it("dismisses on an outside tap, keyboard focus leaving, or Escape", async () => {
    const { container } = render(<><ScheduleActions><button>Prepare changes</button></ScheduleActions><button>Outside</button></>);
    const summary = screen.getByLabelText("Schedule actions");
    const menu = container.querySelector("details")!;
    await userEvent.click(summary);
    fireEvent.pointerDown(screen.getByRole("button", { name: "Outside" }));
    expect(menu).not.toHaveAttribute("open");
    await userEvent.click(summary);
    fireEvent.blur(summary, { relatedTarget: screen.getByRole("button", { name: "Outside" }) });
    expect(menu).not.toHaveAttribute("open");
    await userEvent.click(summary);
    fireEvent.keyDown(screen.getByRole("button", { name: "Prepare changes" }), { key: "Escape" });
    expect(menu).not.toHaveAttribute("open");
    expect(summary).toHaveFocus();
  });
});
