import { cleanup, render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { ComponentProps } from "react";
import type { AttendanceContinuityWorkspace, TeacherClassSummary } from "../../features/operations/api";
import { AttendanceContinuityPanel } from "./AttendanceContinuityPanel";

afterEach(cleanup);

const classes: TeacherClassSummary[] = [{
  class_section_id: "class-7a",
  class_name: "Class 7A",
  grade: "7",
  section: "A",
  room_number: "204",
  term_name: "Term 1",
  academic_year: "2026-27",
  starts_at: null,
  ends_at: null,
  student_count: 25,
  marked_count: 0,
  attending_count: 0,
  absent_count: 0,
  subjects: ["English"],
  submission_status: "not_started",
  periods_today: 1,
  assigned_teachers: ["Kavita Mehta"],
  instructional: true,
  date_open: true,
  can_mark: true,
  availability_reason: null,
  submission_authorized: true,
}];

const workspace: AttendanceContinuityWorkspace = {
  date: "2026-10-03",
  summary: { pending: 1, quarantined: 1, accepted: 4, rejected: 0 },
  cases: [{
    id: "case-1",
    batch_id: "batch-1",
    reason_code: "source_requires_review",
    reason: "Paper and office observations require an explicit attendance-desk review before publication.",
    details: {},
    state: "open",
    opened_at: "2026-10-03T09:35:00.000Z",
    date: "2026-10-03",
    source: "paper",
    source_reference: "Register book 7A, page 42",
    observed_at: "2026-10-03T09:30:00.000Z",
    received_at: "2026-10-03T09:35:00.000Z",
    roster_count: 25,
    expected_register_revision: 0,
    class_section_id: "class-7a",
    class_name: "Class 7A",
    recorded_by_name: "Meera Kapoor",
    current_revision: 0,
    register_state: "draft",
  }],
};

function panel(props: Partial<ComponentProps<typeof AttendanceContinuityPanel>> = {}) {
  return <MemoryRouter><AttendanceContinuityPanel data={workspace} classes={classes} date="2026-10-03" loading={false} error={null} onDecision={vi.fn(() => Promise.resolve())} {...props} /></MemoryRouter>;
}

describe("attendance continuity review", () => {
  it("routes paper capture into a class register and applies reviewed evidence with a note", async () => {
    const interact = userEvent.setup();
    const onDecision = vi.fn(() => Promise.resolve());
    render(<MemoryRouter><AttendanceContinuityPanel
      data={workspace}
      classes={classes}
      date="2026-10-03"
      loading={false}
      error={null}
      onDecision={onDecision}
    /></MemoryRouter>);

    expect(screen.getByRole("link", { name: /Enter sheet/ })).not.toBeVisible();
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Paper & offline entries");
    expect(screen.queryByText(workspace.cases[0]!.reason)).not.toBeInTheDocument();
    await interact.click(screen.getByText("Enter a paper register"));
    expect(screen.getByRole("link", { name: /Enter sheet/ })).toHaveAttribute(
      "href",
      "/principal/attendance?class_section_id=class-7a&date=2026-10-03&source=paper",
    );
    expect(screen.getByText("4")).not.toBeVisible();
    await interact.click(screen.getByText("Processed · 3 Oct 2026"));
    expect(screen.getByText("4")).toBeVisible();
    const card = screen.getByRole("article");
    await interact.click(within(card).getByRole("button", { name: "Review" }));
    const apply = within(card).getByRole("button", { name: "Apply to register" });
    expect(apply).toBeDisabled();
    expect(within(card).getByText(workspace.cases[0]!.reason)).toBeVisible();
    expect(within(card).getByText("Register book 7A, page 42")).toBeVisible();
    await interact.type(within(card).getByRole("textbox", { name: "Review note" }), "Matched all rows to the signed paper sheet");
    await interact.click(apply);
    await waitFor(() => expect(onDecision).toHaveBeenCalledWith(
      "case-1",
      "accept",
      "Matched all rows to the signed paper sheet",
      0,
    ));
  });

  it("does not allow a locked register to be applied", async () => {
    const interact = userEvent.setup();
    render(<MemoryRouter><AttendanceContinuityPanel
      data={{ ...workspace, cases: [{ ...workspace.cases[0]!, register_state: "locked" }] }}
      classes={classes}
      date="2026-10-03"
      loading={false}
      error={null}
      onDecision={vi.fn(() => Promise.resolve())}
    /></MemoryRouter>);
    await interact.click(screen.getByRole("button", { name: "Review" }));
    await interact.type(screen.getByRole("textbox", { name: "Review note" }), "Verified against signed register");
    expect(screen.getByText(/Unlock this register/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Apply to register" })).toBeDisabled();
  });

  it("keeps the empty state short without zero-count summaries", () => {
    render(panel({ data: { ...workspace, summary: { pending: 0, quarantined: 0, accepted: 0, rejected: 0 }, cases: [] } }));
    expect(screen.getByText("Nothing to review.")).toBeVisible();
    expect(screen.queryByText(/Processed|to review$|Quarantined|Syncing/)).not.toBeInTheDocument();
    expect(screen.getAllByRole("heading")).toHaveLength(1);
    expect(screen.getByRole("combobox")).not.toBeVisible();
  });

  it("does not present missing, loading or failed data as an empty review queue", () => {
    const view = render(panel({ loading: true }));
    expect(screen.getByRole("status")).toHaveTextContent("Loading entries");
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
    expect(screen.queryByText("Nothing to review.")).not.toBeInTheDocument();
    view.rerender(panel({ error: new Error("Unable to load entries") }));
    expect(screen.getByRole("alert")).toHaveTextContent("Unable to load entries");
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
    expect(screen.queryByText(/to review$/)).not.toBeInTheDocument();
    view.rerender(panel({ data: undefined }));
    expect(screen.getByText("Review status unavailable.")).toBeVisible();
    expect(screen.queryByText("Nothing to review.")).not.toBeInTheDocument();
  });

  it("shows each entry's date, full queue total and date-scoped processed counts", async () => {
    const interact = userEvent.setup();
    render(panel({ date: "2026-10-08", data: { ...workspace, date: "2026-10-08", summary: { ...workspace.summary, quarantined: 51 } } }));
    expect(screen.getByText("3 Oct 2026 · Paper register")).toBeVisible();
    expect(screen.getByText("51 to review")).toBeVisible();
    expect(screen.getByText(/Showing 1 of 51 entries/)).toBeVisible();
    expect(screen.getByText("Processed · 8 Oct 2026")).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("1 entry awaiting processing");
    await interact.click(screen.getByText("Enter a paper register"));
    expect(screen.getByRole("link", { name: /Enter sheet/ })).toHaveAttribute("href", expect.stringContaining("date=2026-10-08"));
  });

  it("uses the available class when the roster loads or changes, and avoids an empty link", async () => {
    const interact = userEvent.setup();
    const view = render(panel({ classes: [] }));
    await interact.click(screen.getByText("Enter a paper register"));
    expect(screen.getByText("No classes available for paper entry.")).toBeVisible();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    view.rerender(panel());
    expect(screen.getByRole("combobox", { name: "Class" })).toHaveValue("class-7a");
    view.rerender(panel({ classes: [{ ...classes[0]!, class_section_id: "class-8a", class_name: "Class 8A" }] }));
    expect(screen.getByRole("link", { name: /Enter sheet/ })).toHaveAttribute("href", expect.stringContaining("class_section_id=class-8a"));
  });

  it("retains verification warnings, the required note and expected revision on rejection", async () => {
    const interact = userEvent.setup();
    const onDecision = vi.fn(() => Promise.resolve());
    render(panel({ onDecision, data: { ...workspace, cases: [{ ...workspace.cases[0]!, current_revision: 7, reason_code: "roster_changed", reason: "The saved roster signature is invalid." }] } }));
    expect(screen.getByText("Student list needs checking")).toBeVisible();
    await interact.click(screen.getByRole("button", { name: "Review" }));
    expect(screen.getByText("The saved roster signature is invalid.")).toBeVisible();
    const reject = screen.getByRole("button", { name: "Reject entry" });
    await interact.type(screen.getByRole("textbox", { name: "Review note" }), "  ");
    expect(reject).toBeDisabled();
    await interact.type(screen.getByRole("textbox", { name: "Review note" }), "Could not verify the original sheet");
    await interact.click(reject);
    await waitFor(() => expect(onDecision).toHaveBeenCalledWith("case-1", "reject", "Could not verify the original sheet", 7));
  });

  it("prevents duplicate decisions while saving and keeps a failed review open", async () => {
    const interact = userEvent.setup();
    let rejectDecision!: (error: Error) => void;
    const onDecision = vi.fn(() => new Promise<void>((_resolve, reject) => { rejectDecision = reject; }));
    render(panel({ onDecision }));
    await interact.click(screen.getByRole("button", { name: "Review" }));
    await interact.type(screen.getByRole("textbox", { name: "Review note" }), "Verified the sheet");
    await interact.click(screen.getByRole("button", { name: "Apply to register" }));
    expect(screen.getByRole("button", { name: "Close" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Reject entry" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "Review note" })).toBeDisabled();
    rejectDecision(new Error("The register changed. Reload before applying."));
    expect(await screen.findByRole("alert")).toHaveTextContent("The register changed");
    expect(screen.getByRole("textbox", { name: "Review note" })).toHaveValue("Verified the sheet");
    expect(onDecision).toHaveBeenCalledTimes(1);
  });
});
