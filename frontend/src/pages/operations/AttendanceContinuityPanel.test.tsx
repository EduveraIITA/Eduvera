import { cleanup, render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
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

    expect(screen.getByRole("link", { name: /Enter sheet/ })).toHaveAttribute(
      "href",
      "/principal/attendance?class_section_id=class-7a&date=2026-10-03&source=paper",
    );
    expect(screen.getByText("4")).toBeVisible();
    const card = screen.getByRole("article");
    await interact.click(within(card).getByRole("button", { name: "Review" }));
    const apply = within(card).getByRole("button", { name: "Apply to register" });
    expect(apply).toBeDisabled();
    await interact.type(within(card).getByRole("textbox", { name: "Decision note" }), "Matched all rows to the signed paper sheet");
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
    await interact.type(screen.getByRole("textbox", { name: "Decision note" }), "Verified against signed register");
    expect(screen.getByText(/Unlock this register/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Apply to register" })).toBeDisabled();
  });
});
