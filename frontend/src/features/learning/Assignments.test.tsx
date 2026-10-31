import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../lib/api";
import type { ExecutionEnvironment } from "../simulation/executionEnvironment";
import type { WorkspaceManifest } from "../workspace/types";
import { LearningAssignmentsRoute } from "./LearningAssignmentsRoute";
import { AssignmentWorkView } from "./AssignmentWorkView";
import { AssignmentComposer } from "./AssignmentComposer";
import { endOfferingResponsibility, getLearningOffering } from "./offeringApi";
import assignmentStyles from "./learning-assignments.css?inline";
import { detachAssignmentFile, getAssignment, getAssignments, publishAssignment, reviewAssignmentWork, saveAssignment, saveAssignmentWork, submitAssignmentWork, uploadAssignmentFile,
  type AssignmentClassDetail, type AssignmentItem, type AssignmentList, type AssignmentWork } from "./assignmentApi";

const state = vi.hoisted((): { actor: string; environment: ExecutionEnvironment; manifest: WorkspaceManifest | null } => ({ actor: "teacher", environment: { mode: "live" }, manifest: null }));
vi.mock("../auth/AuthContext", async original => ({ ...await original<typeof import("../auth/AuthContext")>(), useOptionalAuth: () => ({ user: { id: state.actor } }) }));
vi.mock("../simulation/ExecutionEnvironmentContext", () => ({ useExecutionEnvironment: () => state.environment }));
vi.mock("../workspace/useWorkspaceManifest", () => ({ useWorkspaceManifest: () => ({ data: state.manifest, isPending: false, error: null, refetch: vi.fn() }) }));
vi.mock("../../pages/operations/OperationsShell", () => ({ OperationsShell: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock("./assignmentApi", async original => ({ ...await original<typeof import("./assignmentApi")>(), getAssignment: vi.fn(), getAssignments: vi.fn(),
  saveAssignment: vi.fn(), publishAssignment: vi.fn(), saveAssignmentWork: vi.fn(), submitAssignmentWork: vi.fn(), uploadAssignmentFile: vi.fn(), reviewAssignmentWork: vi.fn(), detachAssignmentFile: vi.fn() }));
vi.mock("./offeringApi", async original => ({ ...await original<typeof import("./offeringApi")>(), getLearningOffering: vi.fn(), endOfferingResponsibility: vi.fn() }));
const id = "13000000-0000-4000-8000-000000000001", classId = "13000000-0000-4000-8000-000000000002";
const item: AssignmentItem = { id, school_id: "school", class_section_id: classId, term_id: "term", subject_id: null, author_id: "teacher", reviewer_id: "teacher",
  title: "Programming assignment", instructions: "Explain the stopping condition.", due_at: null, cutoff_at: null, state: "published", revision: 2,
  published_at: "2026-10-23T08:00:00Z", submission_mode: "either", max_attempts: null, policy_version: 1, resubmission_mode: "on_request" };
const list: AssignmentList = { context: "class", can_create: true, can_general: true, timezone: "UTC", class_section: { id: classId, label: "Class 7A" },
  terms: [{ id: "term", name: "Term 1" }], subjects: [], reviewers: [{ id: "teacher", name: "Meera", subject_id: null }], items: [], page: 1, has_more: false };
const teacherDetail: AssignmentClassDetail = { context: "class", item: { ...item, state: "draft", revision: 1 }, timezone: "UTC", can_edit: true, can_review: true,
  publication_preview: { count: 2, audience_hash: "a".repeat(64) }, progress: { items: [], total: 0, submitted: 0, needs_review: 0, page: 1, has_more: false } };
const work: AssignmentWork = { context: "learner", item, timezone: "UTC", student: { id: "learner", name: "Sana" }, state: "draft", can_write: true, can_review: false,
  draft: { body: "Saved response", revision: 1, updated_at: "2026-10-23T08:10:00Z" }, files: [], attempts: [] };
function manifest(): WorkspaceManifest { return { version: 1, revision: "assignment", capabilities: [], context: { institution_id: "school", actor_user_id: state.actor,
  environment: state.environment.mode === "live" ? { kind: "live" } : { kind: "simulation", namespace_id: state.environment.namespaceId, virtual_now: "2026-10-23T08:00:00Z" } },
  today: { now: [], attention: { total: 0, overdue: 0, due_soon: 0 }, next: [] }, work: { total: 0, items: [] },
  areas: [{ key: "messages", label: "Messages", href: "/areas/messages", capabilities: ["learning.assignments.manage"], scopes: [], surfaces: [{ key: "assignments", label: "Assignments", href: "/areas/messages/assignments", capabilities: ["learning.assignments.manage"], scopes: [] }] }],
  more: { setup: [], other: [] }, freshness: { state: "current", as_of: "2026-10-23", source_revision: "1" } }; }
function Location() { const location = useLocation(); return <output aria-label="URL">{location.pathname}{location.search}</output>; }
function show(url = `/areas/messages/assignments?scope=class&class_section_id=${classId}`) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = () => <QueryClientProvider client={client}><MemoryRouter initialEntries={[url]}><LearningAssignmentsRoute /><Location /></MemoryRouter></QueryClientProvider>;
  const view = render(tree()); return { client, rerender: () => view.rerender(tree()) };
}
function showWork(data: AssignmentWork = work, refresh = vi.fn().mockResolvedValue(undefined), onLeave = vi.fn()) {
  const tree = (value: AssignmentWork) => <MemoryRouter><AssignmentWorkView data={value} refresh={refresh} readOnly={false} onLeave={onLeave} /></MemoryRouter>;
  const view = render(tree(data)); return { refresh, onLeave, rerender: (value: AssignmentWork) => view.rerender(tree(value)) };
}
beforeAll(() => { HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); }; HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); }; });
beforeEach(() => {
  state.actor = "teacher"; state.environment = { mode: "live" }; state.manifest = manifest();
  vi.mocked(getAssignments).mockResolvedValue(list); vi.mocked(getAssignment).mockResolvedValue(teacherDetail);
  vi.mocked(saveAssignment).mockImplementation(body => Promise.resolve({ id: String(body.assignment_id), revision: Number(body.expected_revision) + 1 }));
  vi.mocked(publishAssignment).mockImplementation(source => Promise.resolve({ id: source, revision: 2, audience_count: 2 }));
  vi.mocked(saveAssignmentWork).mockResolvedValue({ revision: 2 }); vi.mocked(submitAssignmentWork).mockResolvedValue({ attempt_id: "attempt", attempt_number: 1, submitted_at: "2026-10-23T09:00:00Z", revision: 2 });
  vi.mocked(reviewAssignmentWork).mockResolvedValue({}); vi.mocked(uploadAssignmentFile).mockResolvedValue({ revision: 3 });
  vi.mocked(detachAssignmentFile).mockResolvedValue({ revision: 3 });
  vi.mocked(getLearningOffering).mockResolvedValue({ id: "offering", name: "Saturday robotics", revision: 1, can_manage: false, can_publish: true, can_review: true, current_instructor: { id: "teaching", person_id: "teacher-person", name: "Meera", revision: 1 }, own_enrollment: null, learner_count: 1, starts_on: "2026-10-23", today: "2026-10-23", timezone: "UTC", enrollments: [] });
  vi.mocked(endOfferingResponsibility).mockResolvedValue({ id: "offering", revision: 2 });
});
afterEach(() => { cleanup(); vi.resetAllMocks(); vi.restoreAllMocks(); });
async function compose() {
  await userEvent.click(await screen.findByRole("button", { name: "New assignment" }));
  await userEvent.type(screen.getByLabelText("Title"), "Loops"); await userEvent.type(screen.getByLabelText("Instructions"), "Explain how it stops.");
}
describe("individual assignments in the common workspace", () => {
  it("uses theme-readable link/focus tokens separately from filled action backgrounds", () => {
    expect(assignmentStyles).not.toMatch(/(?:^|[;{]\s*)color:\s*var\(--thatcampus-action\)/u);
    expect(assignmentStyles).toContain("outline: 3px solid var(--thatcampus-brand)");
    expect(assignmentStyles).toContain("background: var(--thatcampus-action); color: var(--thatcampus-on-action)");
  });
  it("guards and exactly retries an unconfirmed roster end without granting the manager private work access", async () => {
    const group = { id: "offering", name: "Saturday robotics", revision: 1, can_manage: true, can_publish: false, can_review: false, current_instructor: { id: "teaching", person_id: "teacher-person", name: "Meera", revision: 1 }, own_enrollment: null, learner_count: 1, starts_on: "2026-10-23", today: "2026-10-23", timezone: "UTC", enrollments: [{ id: "registration", person_id: "sana-person", name: "Sana", revision: 3, starts_on: "2026-10-23", ends_on: null }] };
    vi.mocked(getLearningOffering).mockResolvedValue(group); vi.mocked(endOfferingResponsibility).mockRejectedValueOnce(new ApiError("Pending roster change", 409));
    show("/areas/messages/assignments?scope=offering&offering_id=offering"); await userEvent.click(await screen.findByRole("button", { name: "Manage group" }));
    await userEvent.click(screen.getByRole("button", { name: "End registration for Sana" })); await userEvent.type(screen.getByLabelText("Reason"), "Learner withdrew.");
    await userEvent.click(screen.getByRole("button", { name: "End today" })); expect(await screen.findByRole("alert")).toHaveTextContent("Pending roster change");
    const unload = new Event("beforeunload", { cancelable: true }); fireEvent(window, unload); expect(unload.defaultPrevented).toBe(true);
    expect(screen.getByLabelText("Reason")).toBeDisabled(); vi.mocked(getLearningOffering).mockResolvedValue({ ...group, revision: 2, learner_count: 0, enrollments: [] });
    await userEvent.click(screen.getByRole("button", { name: "Retry same action" })); await waitFor(() => expect(endOfferingResponsibility).toHaveBeenCalledTimes(2));
    expect(vi.mocked(endOfferingResponsibility).mock.calls[0]).toEqual(vi.mocked(endOfferingResponsibility).mock.calls[1]);
    expect(vi.mocked(endOfferingResponsibility).mock.calls[0]).toEqual(["offering", "enrollments", "registration", expect.objectContaining({ expected_revision: 3, reason: "Learner withdrew." })]);
    expect(getAssignments).not.toHaveBeenCalled();
  });
  it("keeps the same composer and exact accepted recovery mounted through a transient route refresh failure", async () => {
    const view = show(); await compose();
    vi.mocked(getAssignments).mockRejectedValue(new ApiError("Temporary read failure", 503));
    await act(async () => { await view.client.invalidateQueries(); });
    expect(await screen.findByText(/The list could not refresh/)).toBeVisible(); expect(screen.getByLabelText("Title")).toHaveValue("Loops");
    await userEvent.click(screen.getByRole("button", { name: "Save draft", exact: true }));
    expect(await screen.findByRole("button", { name: "Refresh saved assignment" })).toBeVisible(); expect(screen.getByLabelText("Instructions")).toHaveValue("Explain how it stops.");
    vi.mocked(getAssignments).mockResolvedValue(list); await userEvent.click(screen.getByRole("button", { name: "Refresh saved assignment" }));
    expect(await screen.findByText("Draft saved")).toBeVisible(); expect(saveAssignment).toHaveBeenCalledOnce();
  });
  it("fails closed on explicit source revocation rather than retaining a cached private editor", async () => {
    const view = show(); await compose(); vi.mocked(getAssignments).mockRejectedValue(new ApiError("Authority ended", 403));
    await act(async () => { await view.client.invalidateQueries(); });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument()); expect(screen.queryByLabelText("Instructions")).not.toBeInTheDocument();
  });
  it.each([false, true])("recovers a proven stale detach with a fresh review for person route %s", async person => {
    const data: AssignmentWork = { ...work, ...(person ? { student: null, learner: { id: "canonical-person", person_id: "canonical-person", name: "Sana" }, item: { ...item, context_kind: "learning_offering", offering_id: "offering", class_section_id: null, term_id: null } } : {}), files: [{ id: "file", original_name: "notes.txt", content_type: "text/plain", size_bytes: 10, sha256: "a".repeat(64) }] };
    vi.mocked(detachAssignmentFile).mockImplementationOnce((_id, _learner, _file, body) => Promise.reject(new ApiError("Changed", 409, { error: { fields: { assignment_obsolete: { code: "assignment_revision_obsolete", confirmation: "permanently_inapplicable", receipt_state: "absent", handler: "learning.assignments", source_id: id, command_id: body.command_id, expected_revision: 1, current_revision: 2 } } } })));
    const current: AssignmentWork = { ...data, draft: { ...data.draft!, revision: 2 } };
    const refresh = vi.fn(() => { view.rerender(current); return Promise.resolve(); }), view = showWork(data, refresh);
    await userEvent.click(screen.getByRole("button", { name: "Remove notes.txt from draft" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Your text is kept");
    await userEvent.click(screen.getByRole("button", { name: "Refresh saved work" }));
    await userEvent.click(await screen.findByRole("button", { name: "Use saved draft" }));
    await userEvent.click(screen.getByRole("button", { name: "Remove notes.txt from draft" }));
    await waitFor(() => expect(detachAssignmentFile).toHaveBeenCalledTimes(2));
    const [first, second] = vi.mocked(detachAssignmentFile).mock.calls;
    expect(second?.[3].expected_revision).toBe(2); expect(second?.[3].command_id).not.toBe(first?.[3].command_id); expect(second?.[4]).toBe(person ? "person" : "student");
  });
  it("lets the setup operator manage a group without inferring permission to private assignment work", async () => {
    vi.mocked(getLearningOffering).mockResolvedValue({ id: "offering", name: "Saturday robotics", revision: 1, can_manage: true, can_publish: false, can_review: false, current_instructor: { id: "teaching", person_id: "teacher-person", name: "Meera", revision: 1 }, own_enrollment: null, learner_count: 1, starts_on: "2026-10-23", today: "2026-10-23", timezone: "UTC", enrollments: [] });
    show("/areas/messages/assignments?scope=offering&offering_id=offering");
    expect(await screen.findByRole("button", { name: "Manage group" })).toBeVisible(); expect(screen.getByText(/Private submissions stay/)).toBeVisible();
    expect(getAssignments).not.toHaveBeenCalled(); expect(getAssignment).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "New assignment" })).not.toBeInTheDocument();
  });
  it("publishes native offering work without a fabricated class, term or student", async () => {
    const native = { ...item, context_kind: "learning_offering" as const, offering_id: "offering", class_section_id: null, term_id: null };
    vi.mocked(getAssignments).mockResolvedValue({ ...list, context: "offering", class_section: undefined, terms: undefined, offering: { id: "offering", name: "Saturday robotics", revision: 1 } });
    vi.mocked(getAssignment).mockResolvedValue({ ...teacherDetail, context: "offering", item: { ...native, state: "draft", revision: 1 } });
    show("/areas/messages/assignments?scope=offering&offering_id=offering"); await compose();
    await userEvent.click(screen.getByRole("button", { name: "Review", exact: true })); await userEvent.click(screen.getByRole("button", { name: "Save and review" }));
    expect(await screen.findByText("2 learners in this published audience")).toBeVisible();
    const body = vi.mocked(saveAssignment).mock.calls[0]![0];
    expect(body).toMatchObject({ context_kind: "learning_offering", offering_id: "offering", reviewer_id: "teacher" });
    expect(body).not.toHaveProperty("class_section_id"); expect(body).not.toHaveProperty("term_id"); expect(body).not.toHaveProperty("subject_id");
  });
  it("uses the native canonical person route rather than treating a person as a legacy student", async () => {
    showWork({ ...work, student: null, learner: { id: "canonical-person", person_id: "canonical-person", name: "Sana" }, item: { ...item, context_kind: "learning_offering", offering_id: "offering", class_section_id: null, term_id: null } });
    await userEvent.type(screen.getByLabelText("Your response"), " revised"); await userEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(saveAssignmentWork).toHaveBeenCalledOnce());
    expect(vi.mocked(saveAssignmentWork).mock.calls[0]).toEqual([id, "canonical-person", expect.objectContaining({ body: "Saved response revised", expected_revision: 1 }), "person"]);
  });
  it("retains class save payload compatibility with no new context defaults", async () => {
    show(); await compose(); await userEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(saveAssignment).toHaveBeenCalledOnce()); const body = vi.mocked(saveAssignment).mock.calls[0]![0];
    expect(body).toMatchObject({ class_section_id: classId, term_id: "term" }); expect(body).not.toHaveProperty("context_kind"); expect(body).not.toHaveProperty("offering_id");
  });
  it("keeps the heading utility icon and New assignment label in one centered flex row", async () => {
    const style = document.createElement("style"); style.textContent = typeof assignmentStyles === "string" ? assignmentStyles : ""; document.head.append(style);
    try {
      show(); const button = await screen.findByRole("button", { name: "New assignment" });
      expect(getComputedStyle(button)).toMatchObject({ display: "inline-flex", alignItems: "center", justifyContent: "center", whiteSpace: "nowrap", flexShrink: "0" });
      expect(getComputedStyle(button).gap).toBe("8px");
      const icon = button.querySelector("svg"); expect(icon).not.toBeNull();
      expect(getComputedStyle(icon!)).toHaveProperty("flexShrink", "0"); expect(button).toHaveAccessibleName("New assignment");
    } finally { style.remove(); }
  });
  it("saves a real draft before publication and confirms audience, policy and exact reviewer without a configuration wizard", async () => {
    show(); await compose(); await userEvent.click(screen.getByRole("button", { name: "Review", exact: true }));
    await userEvent.click(screen.getByRole("button", { name: "Save and review" }));
    expect(await screen.findByText("2 learners in this published audience")).toBeVisible(); expect(screen.getByText("Meera")).toBeVisible();
    expect(screen.queryByText(/subscription|behaviour|selector/i)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Publish assignment", exact: true }));
    await waitFor(() => expect(publishAssignment).toHaveBeenCalledOnce());
    expect(vi.mocked(publishAssignment).mock.calls[0]?.[1]).toMatchObject({ expected_revision: 1, audience_hash: "a".repeat(64) });
    expect(vi.mocked(saveAssignment).mock.calls[0]?.[0]).toMatchObject({ reviewer_id: "teacher", submission_mode: "either", cutoff_at: null, max_attempts: null, resubmission_mode: "on_request" });
  });
  it("selects the sole eligible reviewer after subject changes rather than trapping a hidden empty selection", async () => {
    vi.mocked(getAssignments).mockResolvedValue({ ...list, subjects: [{ id: "math", name: "Math" }], reviewers: [{ id: "teacher", name: "Meera", subject_id: "math" }] });
    show(); await compose(); await userEvent.click(screen.getByText("Options", { selector: "summary" })); await userEvent.selectOptions(screen.getByLabelText("Subject"), "math");
    expect(screen.getByText("Reviewer · Meera")).toBeVisible(); expect(screen.getByRole("button", { name: "Review", exact: true })).toBeEnabled();
  });
  it("confirms a saved composer draft accessibly and clears the confirmation as soon as edits change", async () => {
    show(); await compose(); expect(screen.queryByText("Draft saved")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Save draft", exact: true }));
    expect(await screen.findByText("Draft saved")).toHaveAttribute("role", "status"); expect(screen.getByRole("dialog")).toBeVisible();
    await userEvent.type(screen.getByLabelText("Title"), " updated"); expect(screen.queryByText("Draft saved")).not.toBeInTheDocument();
  });
  it("keeps accepted-unrefreshed composer recovery separate from Draft saved without repeating a save", async () => {
    const refresh = vi.fn().mockRejectedValueOnce(new Error("Read unavailable")).mockResolvedValue(undefined);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MemoryRouter><AssignmentComposer list={list} initial={teacherDetail.item} actorId="teacher"
      refresh={refresh} onClose={vi.fn()} onSaved={vi.fn()} /></MemoryRouter></QueryClientProvider>);
    await userEvent.click(screen.getByRole("button", { name: "Save draft", exact: true }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Saved."); expect(screen.queryByText("Draft saved")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toBeDisabled(); await userEvent.click(screen.getByRole("button", { name: "Refresh saved assignment" }));
    expect(await screen.findByText("Draft saved")).toHaveAttribute("role", "status"); expect(screen.getByLabelText("Title")).toBeEnabled(); expect(saveAssignment).toHaveBeenCalledOnce();
  });
  it("keeps unconfirmed draft input locked and replays the same command, not a new save after a generic read", async () => {
    vi.mocked(saveAssignment).mockRejectedValueOnce(new Error("Response lost")); show(); await compose();
    await userEvent.click(screen.getByRole("button", { name: "Save draft", exact: true }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Response lost"); expect(screen.getByLabelText("Title")).toBeDisabled();
    expect(screen.queryByText("Draft saved")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry same action" }));
    await waitFor(() => expect(saveAssignment).toHaveBeenCalledTimes(2)); expect(vi.mocked(saveAssignment).mock.calls[0]).toEqual(vi.mocked(saveAssignment).mock.calls[1]);
  });
  it("blocks rapid submission clicks and retains an exact retry through a 409/pending outcome", async () => {
    let reject!: (cause: Error) => void;
    vi.mocked(submitAssignmentWork).mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail; }));
    showWork(); await userEvent.click(screen.getByRole("button", { name: "Review submission" }));
    const button = screen.getByRole("button", { name: "Submit assignment" }); fireEvent.click(button); fireEvent.click(button); expect(submitAssignmentWork).toHaveBeenCalledOnce();
    await act(() => { reject(new ApiError("Still pending", 409)); return Promise.resolve(); });
    expect(await screen.findByRole("alert")).toHaveTextContent("Still pending");
    await userEvent.click(screen.getByRole("button", { name: "Retry same action" }));
    await waitFor(() => expect(submitAssignmentWork).toHaveBeenCalledTimes(2)); expect(vi.mocked(submitAssignmentWork).mock.calls[0]).toEqual(vi.mocked(submitAssignmentWork).mock.calls[1]);
  });
  it("recognizes its own accepted submission revision without inventing a concurrent draft change", async () => {
    const submitted: AssignmentWork = { ...work, state: "submitted", can_write: false, can_submit: false, draft: { ...work.draft!, revision: 2 },
      attempts: [{ id: "attempt", attempt_number: 1, body: work.draft!.body, submitted_at: "2026-10-23T09:00:00Z", manifest_hash: "a".repeat(64), late: false, files: [], review: null }] };
    const refresh = vi.fn(() => { view.rerender(submitted); return Promise.resolve(); }); const view = showWork(work, refresh);
    await userEvent.click(screen.getByRole("button", { name: "Review submission" })); await userEvent.click(screen.getByRole("button", { name: "Submit assignment" }));
    expect(await screen.findByText("Awaiting review")).toBeVisible(); expect(screen.getByText("Attempt 1")).toBeVisible(); expect(screen.getByText("Submission receipt")).toBeVisible();
    expect(screen.queryByText("The saved draft changed. Your text is still here.")).not.toBeInTheDocument(); expect(screen.queryByRole("button", { name: "Use saved draft" })).not.toBeInTheDocument();
    expect(submitAssignmentWork).toHaveBeenCalledOnce();
  });
  it("retains accepted-submit read recovery without a false conflict or repeating the submission", async () => {
    const submitted: AssignmentWork = { ...work, state: "submitted", can_write: false, can_submit: false, draft: { ...work.draft!, revision: 2 },
      attempts: [{ id: "attempt", attempt_number: 1, body: work.draft!.body, submitted_at: "2026-10-23T09:00:00Z", manifest_hash: "a".repeat(64), late: false, files: [], review: null }] };
    const refresh = vi.fn().mockRejectedValueOnce(new Error("Read unavailable")).mockImplementation(() => { view.rerender(submitted); return Promise.resolve(); }); const view = showWork(work, refresh);
    await userEvent.click(screen.getByRole("button", { name: "Review submission" })); await userEvent.click(screen.getByRole("button", { name: "Submit assignment" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Saved."); expect(screen.getByLabelText("Your response")).toBeDisabled();
    expect(screen.queryByText("The saved draft changed. Your text is still here.")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Refresh saved work" })); expect(await screen.findByText("Awaiting review")).toBeVisible();
    expect(submitAssignmentWork).toHaveBeenCalledOnce(); expect(screen.queryByRole("button", { name: "Use saved draft" })).not.toBeInTheDocument();
  });
  it("does not repeat a known accepted save when only the refresh failed", async () => {
    const refresh = vi.fn().mockRejectedValueOnce(new Error("Read unavailable")).mockResolvedValue(undefined);
    showWork(work, refresh); await userEvent.type(screen.getByLabelText("Your response"), " updated"); await userEvent.click(screen.getByRole("button", { name: "Save draft" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Saved."); expect(screen.getByLabelText("Your response")).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Refresh saved work" })); await waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
    expect(saveAssignmentWork).toHaveBeenCalledOnce();
  });
  it("retains stale text and requires an explicit rebase after exact receipt-absent obsolete proof", async () => {
    vi.mocked(saveAssignmentWork).mockImplementationOnce((_source, _student, body) => { throw new ApiError("Changed", 409, { error: { fields: { assignment_obsolete: {
      code: "assignment_revision_obsolete", confirmation: "permanently_inapplicable", receipt_state: "absent", handler: "learning.assignments",
      source_id: id, command_id: body.command_id, expected_revision: body.expected_revision, current_revision: 2,
    } } } }); });
    const current = { ...work, draft: { ...work.draft!, body: "Changed in another session", revision: 2 } };
    const refresh = vi.fn(() => { view.rerender(current); return Promise.resolve(); }); const view = showWork(work, refresh);
    await userEvent.type(screen.getByLabelText("Your response"), " kept locally"); await userEvent.click(screen.getByRole("button", { name: "Save draft" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Your text is kept"); expect(screen.getByLabelText("Your response")).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Refresh saved work" }));
    expect(screen.getByLabelText("Your response")).toHaveValue("Saved response kept locally"); expect(saveAssignmentWork).toHaveBeenCalledOnce();
    await userEvent.click(await screen.findByRole("button", { name: "Keep my text and review again" }));
    expect(screen.getByLabelText("Your response")).toBeEnabled(); await userEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(saveAssignmentWork).toHaveBeenCalledTimes(2));
    expect(vi.mocked(saveAssignmentWork).mock.calls[1]?.[2]).toMatchObject({ expected_revision: 2, body: "Saved response kept locally" });
    expect(vi.mocked(saveAssignmentWork).mock.calls[0]?.[2].command_id).not.toBe(vi.mocked(saveAssignmentWork).mock.calls[1]?.[2].command_id);
  });
  it("saves current text before an attachment and never treats uploading as submission", async () => {
    showWork(); await userEvent.type(screen.getByLabelText("Your response"), " and explanation");
    const input = screen.getByLabelText("Attach file"); await userEvent.upload(input, new File(["print(1)"], "program.txt", { type: "text/plain" }));
    await waitFor(() => expect(uploadAssignmentFile).toHaveBeenCalledOnce());
    expect(saveAssignmentWork).toHaveBeenCalledOnce(); expect(vi.mocked(uploadAssignmentFile).mock.calls[0]?.[2].get("expected_revision")).toBe("2");
    expect(submitAssignmentWork).not.toHaveBeenCalled();
  });
  it("lets only the assigned reviewer request explicit revisions and keeps prior feedback visible", async () => {
    showWork({ ...work, context: "reviewer", state: "submitted", can_write: false, can_review: true, draft: null,
      attempts: [{ id: "attempt", attempt_number: 1, body: "Submitted response", submitted_at: "2026-10-23T09:00:00Z", manifest_hash: "a".repeat(64), late: false, files: [], review: null }] });
    expect(screen.queryByLabelText("Your response")).not.toBeInTheDocument(); await userEvent.click(screen.getByRole("button", { name: "Review attempt 1" }));
    await userEvent.type(screen.getByLabelText("Feedback"), "Explain why it stops."); await userEvent.click(screen.getByLabelText("Request changes")); await userEvent.click(screen.getByRole("button", { name: "Send request" }));
    await waitFor(() => expect(reviewAssignmentWork).toHaveBeenCalledOnce()); expect(vi.mocked(reviewAssignmentWork).mock.calls[0]?.[2]).toMatchObject({ decision: "request_changes", attempt_id: "attempt", expected_revision: 1 });
  });
  it("keeps final review available but does not offer impossible changes beyond the published attempt limit", async () => {
    showWork({ ...work, item: { ...item, max_attempts: 1 }, context: "reviewer", state: "submitted", can_write: false, can_review: true, draft: null,
      attempts: [{ id: "attempt", attempt_number: 1, body: "Final allowed attempt", submitted_at: "2026-10-23T09:00:00Z", manifest_hash: "a".repeat(64), late: false, files: [], review: null }] });
    await userEvent.click(screen.getByRole("button", { name: "Review attempt 1" })); expect(screen.getByText("Attempt limit reached")).toBeVisible();
    expect(screen.queryByLabelText("Request changes")).not.toBeInTheDocument(); await userEvent.type(screen.getByLabelText("Feedback"), "Reviewed this final attempt.");
    expect(screen.getByRole("button", { name: "Finish review" })).toBeEnabled();
  });
  it("guards unsaved text before a known in-page Back action", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false), { onLeave } = showWork();
    await userEvent.type(screen.getByLabelText("Your response"), " unsaved"); await userEvent.click(screen.getByRole("button", { name: "Back to assignment" }));
    expect(confirm).toHaveBeenCalledOnce(); expect(onLeave).not.toHaveBeenCalled();
  });
  it("ignores a late accepted publication after actor/world changes and partitions caches", async () => {
    let accept!: (value: { id: string; revision: number; audience_count: number }) => void;
    vi.mocked(publishAssignment).mockReturnValue(new Promise(resolve => { accept = resolve; }));
    const view = show(); await compose(); await userEvent.click(screen.getByRole("button", { name: "Review", exact: true })); await userEvent.click(screen.getByRole("button", { name: "Save and review" }));
    await userEvent.click(await screen.findByRole("button", { name: "Publish assignment", exact: true }));
    state.actor = "different"; state.environment = { mode: "simulation", namespaceId: "assignment-world", runId: "run", runStatus: "draft", virtualClock: { now: "2026-10-23T08:00:00Z", timeZone: "UTC" } }; state.manifest = manifest(); view.rerender();
    expect(await screen.findByRole("button", { name: "New assignment" })).toBeVisible();
    await act(() => { accept({ id, revision: 2, audience_count: 2 }); return Promise.resolve(); });
    expect(screen.getByLabelText("URL")).not.toHaveTextContent("assignment="); expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(view.client.getQueryCache().getAll().some(query => query.queryKey.includes("different"))).toBe(true);
  });
  it("shows ended Simulation submissions as read-only without hiding the receipt", async () => {
    state.environment = { mode: "simulation", namespaceId: "ended-world", runId: "run", runStatus: "completed", virtualClock: { now: "2026-10-23T08:00:00Z", timeZone: "UTC" } }; state.manifest = manifest();
    vi.mocked(getAssignment).mockResolvedValue({ ...work, state: "submitted", can_write: false, draft: null,
      attempts: [{ id: "attempt", attempt_number: 1, body: "Retained submitted response", submitted_at: "2026-10-23T09:00:00Z", manifest_hash: "a".repeat(64), late: false, files: [], review: null }] });
    show(`/areas/messages/assignments?scope=self&student_id=learner&assignment=${id}`);
    expect(await screen.findByText("Retained submitted response")).toBeVisible(); expect(screen.getByText("This Simulation is read-only.")).toBeVisible(); expect(screen.queryByRole("button", { name: "Submit assignment" })).not.toBeInTheDocument();
    expect(screen.getByText("Submission receipt")).toBeInTheDocument();
  });
});
