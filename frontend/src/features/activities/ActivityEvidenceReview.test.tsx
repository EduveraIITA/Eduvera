import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ActivityEvidenceReview } from "./ActivityEvidenceReview";
import { decideActivityEvidence, reportActivityEvidence, type ActivityRegister } from "./api";
vi.mock("./api", () => ({ decideActivityEvidence: vi.fn(), reportActivityEvidence: vi.fn() }));
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const fixture: ActivityRegister = {
  register: { id: "register", occurrence_id: "occurrence", title: "Night duty", kind: "duty", starts_at: "2026-10-20T16:30:00Z", ends_at: "2026-10-21T00:30:00Z", time_zone: "Asia/Kolkata", place_label: "Main Gate", state: "draft", revision: 2, submitted_at: null, finalized_at: null, policy_revision: null },
  roster: [{ person_id: "guard", name: "Ravi Guard", roles: ["participant"], requirement: "required", status: null, remarks: "", observed_at: null, revision: 0 }], counts: { participants: 1, recorded: 0, unrecorded: 1, present: 0, absent: 0, late: 0, excused: 0 }, capabilities: { can_record: true, can_submit: true, can_finalize: false, can_reopen: false, can_review_evidence: true }, allowed_statuses: ["present", "absent", "late", "excused"], availability_reason: null, pending_evidence: [],
};
describe("reported evidence remains distinct from accepted participation", () => {
  it("records source-bearing paper evidence for review rather than silently marking attendance", async () => {
    const accepted = vi.fn().mockResolvedValue(undefined);
    vi.mocked(reportActivityEvidence).mockResolvedValue(fixture);
    render(<ActivityEvidenceReview schoolId="school-1" register={fixture} disabled={false} onAccepted={accepted} />);
    await userEvent.click(screen.getByRole("button", { name: "Record a paper / late report" }));
    await userEvent.selectOptions(screen.getByLabelText("Participant"), "guard");
    fireEvent.input(screen.getByLabelText("Observed at"), { target: { value: "2026-10-20T22:10" } });
    await userEvent.type(screen.getByLabelText(/Paper \/ source reference/), "Gate paper log 20 Oct");
    await userEvent.type(screen.getByLabelText("What supports this report?"), "Supervisor retained the signed paper list");
    await userEvent.click(screen.getByRole("button", { name: "Submit report for review" }));
    await waitFor(() => expect(reportActivityEvidence).toHaveBeenCalled());
    expect(reportActivityEvidence).toHaveBeenCalledWith("school-1", "register", { expected_revision: 2, person_id: "guard", claimed_status: "present", capture_channel: "offline_paper", observed_at: new Date("2026-10-20T22:10").toISOString(), source_reference: "Gate paper log 20 Oct", note: "Supervisor retained the signed paper list" }, expect.any(String));
    expect(accepted).toHaveBeenCalledWith(fixture, expect.stringContaining("not an accepted attendance decision"));
    expect(decideActivityEvidence).not.toHaveBeenCalled();
  });
  it("requires an explicit review reason and retains the register revision", async () => {
    const evidence = { id: "evidence", person_id: "guard", name: "Ravi Guard", claimed_status: "present" as const, capture_channel: "offline_paper", observed_at: "2026-10-20T16:40:00Z", received_at: "2026-10-21T03:00:00Z", note: "Signed supervisor paper register", source_reference: "paper-1" };
    vi.mocked(decideActivityEvidence).mockResolvedValue(fixture);
    render(<ActivityEvidenceReview schoolId="school-1" register={{ ...fixture, pending_evidence: [evidence] }} disabled={false} onAccepted={vi.fn().mockResolvedValue(undefined)} />);
    expect(screen.getByText("Reports are pending review, not accepted attendance.")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Review report" }));
    await userEvent.type(screen.getByLabelText("Review reason"), "Checked the supervisor's signed source");
    await userEvent.click(screen.getByRole("button", { name: "Save review" }));
    await waitFor(() => expect(decideActivityEvidence).toHaveBeenCalledWith("school-1", "register", "evidence", { expected_revision: 2, decision: "accepted", reason: "Checked the supervisor's signed source" }, expect.any(String)));
  });
  it("does not mix an evidence command into unsaved roster edits", () => {
    render(<ActivityEvidenceReview schoolId="school-1" register={fixture} disabled onAccepted={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Record a paper / late report" })).toBeDisabled();
    expect(reportActivityEvidence).not.toHaveBeenCalled();
  });
});
