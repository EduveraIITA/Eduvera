import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AttendanceRegisterFooter, AttendanceRegisterHeader, AttendanceRegisterProgress, AttendanceRegisterRoster, AttendanceRegisterTools, AttendanceRegisterView } from "./AttendanceRegisterView";

afterEach(cleanup);

describe("one attendance register presentation", () => {
  it("composes the same compact structure without context-specific layout variants", async () => {
    const history = vi.fn(), mark = vi.fn(), submit = vi.fn();
    const { container } = render(<AttendanceRegisterView>
      <AttendanceRegisterHeader title="Programming" state="Submitted" context="Class 7A · Period 1 · Practice room"
        action={<button type="button" onClick={history}>History</button>} />
      <AttendanceRegisterProgress recorded={2} total={3}>
        <button type="button" className="attendance-register-action attendance-register-action--text" onClick={mark}>Mark present</button>
      </AttendanceRegisterProgress>
      <AttendanceRegisterTools id="participants"><label>Find participant<input type="search" /></label><select aria-label="Filter participants"><option>All · 3</option></select></AttendanceRegisterTools>
      <AttendanceRegisterRoster><article aria-label="Aarav Sharma">Aarav Sharma</article></AttendanceRegisterRoster>
      <AttendanceRegisterFooter status="1 unsaved change"><button type="button" className="attendance-register-action attendance-register-action--primary" onClick={submit}>Save correction</button></AttendanceRegisterFooter>
    </AttendanceRegisterView>);
    const heading = screen.getByRole("heading", { name: "Programming", level: 2 });
    expect(within(heading.closest("header")!).getByText("Submitted")).toBeVisible();
    expect(screen.getByText("2 of 3 recorded")).toHaveAttribute("aria-live", "polite");
    expect(screen.getByRole("searchbox", { name: "Find participant" })).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("1 unsaved change");
    expect(container.querySelectorAll(".attendance-register-view")).toHaveLength(1);
    expect(container.querySelector(".attendance-register-view__roster")).toContainElement(screen.getByRole("article"));
    expect(container.querySelector(".roll-call-summary, .roll-call-totals, .roll-call-progress, .roll-call-submit-bar, .activity-register-footer")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "History" }));
    await userEvent.click(screen.getByRole("button", { name: "Mark present" }));
    await userEvent.click(screen.getByRole("button", { name: "Save correction" }));
    expect(history).toHaveBeenCalledOnce();
    expect(mark).toHaveBeenCalledOnce();
    expect(submit).toHaveBeenCalledOnce();
  });

  it("does not invent tools, mutations or a fixed footer for a read-only register", () => {
    const { container } = render(<AttendanceRegisterView>
      <AttendanceRegisterHeader title="Campus safety training" state="Final" context="10–11 am · Campus hall" />
      <AttendanceRegisterProgress recorded={1} total={1} />
      <AttendanceRegisterRoster><article>Ravi Guard</article></AttendanceRegisterRoster>
      <p>This activity was cancelled. Its history is retained.</p>
    </AttendanceRegisterView>);
    expect(screen.getByText("1 of 1 recorded")).toBeVisible();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(container.querySelector("footer")).toBeNull();
    expect(container.querySelector(".attendance-register-view__tools")).toBeNull();
  });
});
