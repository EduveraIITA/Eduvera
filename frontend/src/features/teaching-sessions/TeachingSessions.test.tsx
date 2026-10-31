import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExecutionEnvironment } from "../simulation/executionEnvironment";
import { ApiError } from "../../lib/api";
import { TeachingSessionRoute, readTeachingSelection } from "./TeachingSessionRoute";
import { LessonEditor } from "./LessonEditor";
import { addTeachingMaterial, getTeachingSession, getTeachingSessions, getTeachingWorkOptions, linkTeachingWork, openTeachingSession, saveTeachingLesson, uploadTeachingMaterial, type TeachingSessionDetail } from "./api";
import styles from "./teaching-sessions.css?raw";

let environment: ExecutionEnvironment = { mode: "live" };
vi.mock("../simulation/ExecutionEnvironmentContext", () => ({ useExecutionEnvironment: () => environment }));
vi.mock("../auth/AuthContext", () => ({ useOptionalAuth: () => ({ user: { id: "teacher" } }) }));
vi.mock("../workspace/useWorkspaceManifest", () => ({ useWorkspaceManifest: () => ({ data: { context: { institution_id: "school", actor_user_id: "teacher", time_zone: "UTC", environment: environment.mode === "live" ? { kind: "live" } : { kind: "simulation", namespace_id: "world" } } }, isPending: false, error: null }) }));
vi.mock("../../pages/operations/OperationsShell", () => ({ OperationsShell: ({ title, children }: { title: string; children: React.ReactNode }) => <main><h1>{title}</h1>{children}</main> }));
vi.mock("./api", async original => ({ ...(await original<typeof import("./api")>()), getTeachingSession: vi.fn(), getTeachingSessions: vi.fn(), openTeachingSession: vi.fn(), saveTeachingLesson: vi.fn(), addTeachingMaterial: vi.fn(), uploadTeachingMaterial: vi.fn(), getTeachingWorkOptions: vi.fn(), linkTeachingWork: vi.fn() }));

const detail: TeachingSessionDetail = {
  session: { id: "session-1", date: "2026-10-24", title: "Programming", group_label: "BCA first year", starts_at: "09:00:00", ends_at: "10:00:00", timezone: "UTC", place_label: "Lab 2", teacher_name: "Meera", original_teacher_name: "Meera", is_cover: false, source_kind: "academic", state: "expected", source_fingerprint: "source-1", lesson_state: "empty", href: "/areas/timetable/session?session_id=session-1&date=2026-10-24" },
  lesson: { revision: 0, state: "empty", topic: "", learner_notes: "", preparation: "", reported_at: null, updated_at: null },
  capabilities: { can_manage: true, can_read_preparation: true }, materials: [], history: { items: [], page: 1, has_more: false },
  previous_lesson: { id: "previous", date: "2026-10-23", topic: "Variables", learner_notes: "Bring your earlier example.", href: "/areas/timetable/session?session_id=previous&date=2026-10-23" },
  related: { attendance: { href: "/areas/attendance/registers?session_id=register-1&date=2026-10-24", label: "Take session attendance", grain: "scheduled_session" }, assignments: { href: "/areas/messages/assignments?scope=class&class_section_id=class-1", label: "Assignments" }, practice: null, schedule: { href: "/areas/timetable/planning/day?class=class-1&date=2026-10-24", label: "Change session" } }, availability_reason: null,
};
const Location = () => { const location = useLocation(); return <output data-testid="location">{location.pathname}{location.search}|{JSON.stringify(location.state)}</output>; };
function show(url = "/areas/timetable/session?session_id=session-1&date=2026-10-24") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[{ pathname: url.split("?")[0]!, search: url.includes("?") ? `?${url.split("?")[1]}` : "", state: { portalReturnTo: "/today" } }]}><TeachingSessionRoute /><Location /></MemoryRouter></QueryClientProvider>);
  return client;
}
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});
beforeEach(() => {
  environment = { mode: "live" };
  vi.mocked(getTeachingSession).mockResolvedValue(structuredClone(detail));
  vi.mocked(openTeachingSession).mockResolvedValue(structuredClone(detail));
  vi.mocked(getTeachingSessions).mockResolvedValue({ date: "2026-10-24", page: 1, page_size: 10, total: 1, total_pages: 1, items: [structuredClone(detail.session)] });
  vi.mocked(saveTeachingLesson).mockResolvedValue({ revision: 1 });
  vi.mocked(addTeachingMaterial).mockResolvedValue({ id: "material", revision: 1 });
  vi.mocked(uploadTeachingMaterial).mockResolvedValue({ id: "material", revision: 1 });
  vi.mocked(getTeachingWorkOptions).mockResolvedValue({ supported: true, reason: null, page: 1, page_size: 10, has_more: false, items: [{ work_kind: "assignment", work_id: "assignment-1", title: "Loop practice", due_at: null, href: "/areas/messages/assignments?scope=class&class_section_id=class-1&assignment=assignment-1" }] });
  vi.mocked(linkTeachingWork).mockResolvedValue({ id: "linked", revision: 1 });
});
afterEach(() => { cleanup(); vi.resetAllMocks(); vi.restoreAllMocks(); });

describe("teaching session workspace", () => {
  it("uses strict alternative source selectors and rejects ambiguous or partial links", () => {
    expect(readTeachingSelection(new URLSearchParams("occurrence_id=occurrence"))).toEqual({ occurrenceId: "occurrence" });
    expect(readTeachingSelection(new URLSearchParams("class_section_id=class&period_number=2"))).toEqual({ classId: "class", period: 2 });
    for (const query of ["session_id=a&occurrence_id=b", "class_section_id=class", "period_number=1", "occurrence_id=", "session_id=a&period_number=1"]) expect(readTeachingSelection(new URLSearchParams(query))).toBe(false);
  });
  it("opens a finite date list with source-backed ordinary links", async () => {
    show("/areas/timetable/session?date=2026-10-24");
    expect(await screen.findByRole("link", { name: /Programming/ })).toHaveAttribute("href", detail.session.href);
    expect(getTeachingSessions).toHaveBeenCalledWith("2026-10-24", 1);
    expect(screen.queryByRole("button", { name: /setup|configure/i })).not.toBeInTheDocument();
  });
  it("resolves an occurrence once and retains return context on the canonical stable ID", async () => {
    show("/areas/timetable/session?occurrence_id=occurrence-1&date=2026-10-24");
    await screen.findByRole("region", { name: "Session summary" });
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("session_id=session-1"));
    expect(openTeachingSession).toHaveBeenCalledWith("2026-10-24", { occurrenceId: "occurrence-1" }, 1);
    expect(screen.getByTestId("location")).toHaveTextContent('"portalReturnTo":"/today"');
  });
  it("keeps exact attendance identity, previous topic and authorized work together", async () => {
    show();
    expect(await screen.findByRole("heading", { name: "Programming", level: 1 })).toBeVisible();
    expect(screen.getByRole("link", { name: "Take session attendance" })).toHaveAttribute("href", detail.related.attendance!.href);
    expect(screen.getByText("Variables")).toBeVisible();
    expect(screen.getByRole("link", { name: "Assignments" })).toHaveAttribute("href", detail.related.assignments!.href);
    await userEvent.click(screen.getByRole("link", { name: "Assignments" }));
    expect(screen.getByTestId("location")).toHaveTextContent('"portalReturnTo":"/areas/timetable/session?session_id=session-1&date=2026-10-24"');
  });
  it("labels a daily register honestly rather than implying per-lesson attendance", async () => {
    vi.mocked(getTeachingSession).mockResolvedValue({ ...detail, related: { ...detail.related, attendance: { href: "/areas/attendance/registers?class_section_id=class-1&date=2026-10-24", label: "Take daily attendance", grain: "daily_class" } } });
    show(); expect(await screen.findByText("Attendance is recorded for the day, not separately for this lesson.")).toBeVisible();
  });
  it("does not expose private preparation, prepared topic or private resources to a participant", async () => {
    vi.mocked(getTeachingSession).mockResolvedValue({ ...detail, capabilities: { can_manage: false, can_read_preparation: false }, lesson: { ...detail.lesson, revision: 1, state: "prepared", topic: "PRIVATE-TOPIC", learner_notes: "PRIVATE-NOTES", preparation: "PRIVATE-PREP" }, materials: [{ id: "private", title: "PRIVATE-RESOURCE", kind: "text", body: "PRIVATE-CODE", shared: false } as TeachingSessionDetail["materials"][number]], history: { page: 1, has_more: false, items: [{ revision: 1, state: "prepared", topic: "PRIVATE-HISTORY", learner_notes: "", preparation: "PRIVATE-HISTORY-PREP", reason: "", actor_name: "Meera", recorded_at: "2026-10-24T08:00:00Z" }] } });
    show(); await screen.findByRole("region", { name: "Session summary" });
    expect(screen.queryByText(/PRIVATE-/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Record lesson" })).not.toBeInTheDocument();
    expect(screen.getByText("No lesson has been reported yet.")).toBeVisible();
  });
  it("saves preparation separately from a reported lesson", async () => {
    show(); await userEvent.click(await screen.findByRole("button", { name: "Record lesson" }));
    await userEvent.type(screen.getByLabelText("Topic taught"), "Loops");
    await userEvent.click(screen.getByRole("button", { name: "Save preparation" }));
    await waitFor(() => expect(saveTeachingLesson).toHaveBeenCalledOnce());
    expect(vi.mocked(saveTeachingLesson).mock.calls[0]).toEqual(["session-1", "2026-10-24", expect.objectContaining({ expected_revision: 0, source_fingerprint: "source-1", state: "prepared", topic: "Loops" })]);
  });
  it("locks uncertain inputs and retries exactly the same command before allowing a fresh action", async () => {
    vi.mocked(saveTeachingLesson).mockRejectedValueOnce(new ApiError("Response lost", 503));
    show(); await userEvent.click(await screen.findByRole("button", { name: "Record lesson" }));
    await userEvent.type(screen.getByLabelText("Topic taught"), "Loops"); await userEvent.click(screen.getByRole("button", { name: "Report taught" }));
    expect(await screen.findByRole("button", { name: "Retry same action" })).toBeVisible(); expect(screen.getByLabelText("Topic taught")).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Retry same action" }));
    await waitFor(() => expect(saveTeachingLesson).toHaveBeenCalledTimes(2));
    expect(vi.mocked(saveTeachingLesson).mock.calls[1]).toEqual(vi.mocked(saveTeachingLesson).mock.calls[0]);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
  it("recovers known acceptance by refreshing only, without resending the write", async () => {
    const refresh = vi.fn().mockRejectedValueOnce(new Error("Offline read")).mockResolvedValue(detail), close = vi.fn();
    render(<MemoryRouter><LessonEditor data={detail} refresh={refresh} onClose={close} /></MemoryRouter>);
    await userEvent.type(screen.getByLabelText("Topic taught"), "Loops"); await userEvent.click(screen.getByRole("button", { name: "Report taught" }));
    expect(await screen.findByRole("button", { name: "Refresh saved session" })).toBeVisible(); expect(screen.getByLabelText("Topic taught")).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Refresh saved session" })); await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(saveTeachingLesson).toHaveBeenCalledOnce(); expect(refresh).toHaveBeenCalledTimes(2);
  });
  it("rebases text only after an exact retained source refusal and an explicit current-version review", async () => {
    vi.mocked(saveTeachingLesson).mockImplementationOnce((_id, _date, body) => Promise.reject(new ApiError("Source changed", 409, { error: { fields: { lesson_obsolete: { code: "learning.session_source_changed", confirmation: "permanently_inapplicable", receipt_state: "conflicted", handler: "learning.sessions", command_id: body.command_id, source_id: "session-1", expected_revision: 0, current_revision: 1, reviewed_source_fingerprint: "source-1", current_source_fingerprint: "source-2" } } } })));
    const fresh = { ...detail, session: { ...detail.session, source_fingerprint: "source-2", place_label: "Lab 3" }, lesson: { ...detail.lesson, revision: 1, state: "prepared" as const, topic: "Saved topic" } };
    const refresh = vi.fn().mockResolvedValue(fresh);
    render(<MemoryRouter><LessonEditor data={detail} refresh={refresh} onClose={vi.fn()} /></MemoryRouter>);
    await userEvent.type(screen.getByLabelText("Topic taught"), "My lesson"); await userEvent.click(screen.getByRole("button", { name: "Report taught" }));
    await userEvent.click(await screen.findByRole("button", { name: "Review current version" }));
    expect(await screen.findByText("Saved topic")).toBeVisible(); expect(screen.getByLabelText("Topic taught")).toHaveValue("My lesson"); expect(screen.getByText(/Lab 3/)).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Keep my text" })); await userEvent.click(screen.getByRole("button", { name: "Report taught" }));
    await waitFor(() => expect(saveTeachingLesson).toHaveBeenCalledTimes(2));
    const [first, second] = vi.mocked(saveTeachingLesson).mock.calls;
    expect(second?.[2]).toMatchObject({ expected_revision: 1, source_fingerprint: "source-2", topic: "My lesson" }); expect(second?.[2].command_id).not.toBe(first?.[2].command_id);
  });
  it("does not release a possibly executable source-ABA command using a receipt-absent mismatch", async () => {
    vi.mocked(saveTeachingLesson).mockImplementationOnce((_id, _date, body) => Promise.reject(new ApiError("Source changed", 409, { error: { fields: { lesson_obsolete: { code: "learning.session_source_changed", confirmation: "permanently_inapplicable", receipt_state: "absent", handler: "learning.sessions", command_id: body.command_id, source_id: "session-1", expected_revision: 0, reviewed_source_fingerprint: "source-1", current_source_fingerprint: "source-2" } } } })));
    show(); await userEvent.click(await screen.findByRole("button", { name: "Record lesson" })); await userEvent.type(screen.getByLabelText("Topic taught"), "My lesson"); await userEvent.click(screen.getByRole("button", { name: "Report taught" }));
    expect(await screen.findByRole("button", { name: "Retry same action" })).toBeVisible(); expect(screen.queryByRole("button", { name: "Review current version" })).not.toBeInTheDocument(); expect(screen.getByLabelText("Topic taught")).toBeDisabled();
  });
  it("requires a correction reason and keeps original reported history", async () => {
    vi.mocked(getTeachingSession).mockResolvedValue({ ...detail, lesson: { ...detail.lesson, revision: 1, state: "reported", topic: "Loops", reported_at: "2026-10-24T10:00:00Z" }, history: { page: 1, has_more: false, items: [{ revision: 1, state: "reported", topic: "Loops", learner_notes: "Example one", reason: "", actor_name: "Meera", recorded_at: "2026-10-24T10:00:00Z" }] } });
    show(); await userEvent.click(await screen.findByRole("button", { name: "Correct" }));
    expect(screen.getByRole("button", { name: "Save correction" })).toBeDisabled(); await userEvent.type(screen.getByLabelText("Reason for correction"), "Included the second example.");
    await userEvent.click(screen.getByRole("button", { name: "Save correction" }));
    await waitFor(() => expect(saveTeachingLesson).toHaveBeenCalledOnce()); expect(vi.mocked(saveTeachingLesson).mock.calls[0]?.[2]).toMatchObject({ expected_revision: 1, state: "reported", reason: "Included the second example." });
  });
  it("adds teaching code as a shared resource rather than an assignment submission", async () => {
    show(); await userEvent.click(await screen.findByRole("button", { name: "Add", exact: true }));
    await userEvent.click(screen.getByRole("button", { name: "Text / code" })); await userEvent.type(screen.getByLabelText("Title"), "Loop example"); await userEvent.type(screen.getByLabelText("Text or example code"), "print('hello')");
    await userEvent.click(screen.getByRole("button", { name: "Add resource", exact: true }));
    await waitFor(() => expect(addTeachingMaterial).toHaveBeenCalledOnce()); expect(vi.mocked(addTeachingMaterial).mock.calls[0]).toEqual(["session-1", "2026-10-24", expect.objectContaining({ kind: "text", body: "print('hello')", shared: true, expected_revision: 0, source_fingerprint: "source-1" })]);
  });
  it("retains the selected file and command across an uncertain resource upload", async () => {
    vi.mocked(uploadTeachingMaterial).mockRejectedValueOnce(new ApiError("Upload response lost", 503));
    show(); await userEvent.click(await screen.findByRole("button", { name: "Add", exact: true }));
    const file = new File(["example reading"], "reading.txt", { type: "text/plain", lastModified: 42 }); await userEvent.upload(screen.getByLabelText("File", { selector: "input" }), file);
    expect(screen.getByLabelText<HTMLInputElement>("File", { selector: "input" }).files).toHaveLength(1);
    fireEvent.submit(screen.getByRole("button", { name: "Add resource", exact: true }).closest("form")!); await userEvent.click(await screen.findByRole("button", { name: "Retry same action" }));
    await waitFor(() => expect(uploadTeachingMaterial).toHaveBeenCalledTimes(2));
    const [first, second] = vi.mocked(uploadTeachingMaterial).mock.calls; expect(first?.slice(0, 2)).toEqual(second?.slice(0, 2));
    for (const key of ["command_id", "material_id", "expected_revision", "source_fingerprint", "title", "shared"]) expect(second?.[2].get(key)).toEqual(first?.[2].get(key));
    expect(second?.[2].get("file")).toBe(first?.[2].get("file"));
  });
  it("creates a replacement resource identity while retaining the original version", async () => {
    vi.mocked(getTeachingSession).mockResolvedValue({ ...detail, materials: [{ id: "old-resource", title: "Reading", kind: "link", url: "https://example.test/old", body: "", shared: true, replaces_material_id: null } as TeachingSessionDetail["materials"][number]] });
    show(); await userEvent.click(await screen.findByRole("button", { name: "New version" })); await userEvent.clear(screen.getByLabelText("Web address")); await userEvent.type(screen.getByLabelText("Web address"), "https://example.test/revised");
    await userEvent.click(screen.getByRole("button", { name: "Add version" })); await waitFor(() => expect(addTeachingMaterial).toHaveBeenCalledOnce());
    const input = vi.mocked(addTeachingMaterial).mock.calls[0]?.[2]; expect(input).toMatchObject({ replaces_material_id: "old-resource", title: "Reading", url: "https://example.test/revised" }); expect(input?.material_id).not.toBe("old-resource");
  });
  it("hides cached session data immediately after explicit revocation", async () => {
    const client = show(); await screen.findByRole("region", { name: "Session summary" }); await userEvent.click(screen.getByRole("button", { name: "Record lesson" }));
    vi.mocked(getTeachingSession).mockRejectedValue(new ApiError("Authority ended", 403));
    await act(async () => { await client.invalidateQueries(); });
    expect(await screen.findByText("Your workspace access changed")).toBeVisible(); expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); expect(screen.queryByText("Lab 2")).not.toBeInTheDocument();
  });
  it("immediately hides private cached content when a writer is explicitly denied", async () => {
    vi.mocked(getTeachingSession).mockResolvedValue({ ...detail, lesson: { ...detail.lesson, preparation: "PRIVATE-NOW-REVOKED" } }); vi.mocked(saveTeachingLesson).mockRejectedValueOnce(new ApiError("Authority ended", 403));
    show(); await userEvent.click(await screen.findByRole("button", { name: "Record lesson" })); await userEvent.type(screen.getByLabelText("Topic taught"), "Loops"); await userEvent.click(screen.getByRole("button", { name: "Report taught" }));
    expect(await screen.findByText("Your workspace access changed")).toBeVisible(); expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); expect(screen.queryByText("PRIVATE-NOW-REVOKED")).not.toBeInTheDocument(); expect(screen.queryByText("Lab 2")).not.toBeInTheDocument();
  });
  it("keeps entered lesson text on a transient same-world refresh failure", async () => {
    const client = show(); await userEvent.click(await screen.findByRole("button", { name: "Record lesson" })); await userEvent.type(screen.getByLabelText("Topic taught"), "My unsaved lesson");
    vi.mocked(getTeachingSession).mockRejectedValue(new ApiError("Temporary read failure", 503)); await act(async () => { await client.invalidateQueries(); });
    expect(await screen.findByText(/Your open work is kept/)).toBeVisible(); expect(screen.getByLabelText("Topic taught")).toHaveValue("My unsaved lesson"); expect(saveTeachingLesson).not.toHaveBeenCalled();
  });
  it("links exact published work only with its independent capability", async () => {
    vi.mocked(getTeachingSession).mockResolvedValue({ ...detail, capabilities: { ...detail.capabilities, can_link_work: true } });
    show(); await userEvent.click(await screen.findByRole("button", { name: "Link work" }));
    await userEvent.click(await screen.findByRole("radio", { name: "Loop practice Assignment" }));
    await userEvent.click(within(screen.getByRole("dialog", { name: "Link learning work" })).getByRole("button", { name: "Link work", exact: true }));
    await waitFor(() => expect(linkTeachingWork).toHaveBeenCalledOnce()); expect(vi.mocked(linkTeachingWork).mock.calls[0]).toEqual(["session-1", "2026-10-24", expect.objectContaining({ work_kind: "assignment", work_id: "assignment-1", expected_revision: 0, source_fingerprint: "source-1" })]);
  });
  it("opens associated work with the session return path without widening learner access", async () => {
    const href = "/areas/messages/assignments?scope=self&student_id=student-1&assignment=assignment-1";
    vi.mocked(getTeachingSession).mockResolvedValue({ ...detail, capabilities: { can_manage: false, can_read_preparation: false }, associated_work: [{ id: "link-1", work_kind: "assignment", work_id: "assignment-1", title: "My loop task", due_at: null, href }], related: { attendance: null, assignments: null, practice: null, schedule: null } });
    show(); expect(await screen.findByRole("link", { name: "My loop task Assignment" })).toHaveAttribute("href", href); expect(screen.queryByRole("button", { name: "Link work" })).not.toBeInTheDocument(); expect(getTeachingWorkOptions).not.toHaveBeenCalled();
  });
  it("does not infer a link-work grant from teaching authority", async () => {
    show(); await screen.findByRole("region", { name: "Session summary" }); expect(screen.queryByRole("button", { name: "Link work" })).not.toBeInTheDocument(); expect(getTeachingWorkOptions).not.toHaveBeenCalled();
  });
  it("does not substitute another session or malformed date", async () => {
    show("/areas/timetable/session?session_id=session-1&date=2026-02-30"); expect(screen.getByRole("alert")).toHaveTextContent("incomplete"); expect(getTeachingSession).not.toHaveBeenCalled();
    cleanup(); vi.mocked(getTeachingSession).mockResolvedValue({ ...detail, session: { ...detail.session, id: "other" } }); show();
    expect(await screen.findByText("No other session was substituted.", { exact: false })).toBeVisible(); expect(screen.queryByText("Lab 2")).not.toBeInTheDocument();
  });
  it("keeps the same read-only screen in an ended simulation", async () => {
    environment = { mode: "simulation", namespaceId: "world", runId: "run", runStatus: "completed", virtualClock: { now: "2026-10-24T09:00:00Z", timeZone: "UTC", speed: 1, state: "paused" } } as unknown as ExecutionEnvironment;
    show(); expect(await screen.findByText(/saved session is read-only/)).toBeVisible(); expect(screen.queryByRole("button", { name: "Record lesson" })).not.toBeInTheDocument();
  });
  it("marks omitted simulation bytes unavailable instead of linking to Live", async () => {
    vi.mocked(getTeachingSession).mockResolvedValue({ ...detail, materials: [{ id: "file", title: "Reading", kind: "file", original_name: "reading.pdf", size_bytes: 50, shared: true, download_href: "/api/v1/learning/sessions/session-1/materials/file/file?date=2026-10-24", source_content_omitted: true } as TeachingSessionDetail["materials"][number]] });
    show(); expect(await screen.findByText(/Live content will not be opened/)).toBeVisible(); expect(screen.queryByRole("link", { name: /Download/ })).not.toBeInTheDocument();
  });
  it("uses compact theme tokens, readable inputs and visible focus without gesture controls", () => {
    expect(styles).toContain("padding: 16px"); expect(styles).toContain("font-size: 16px"); expect(styles).toContain("min-height: 44px"); expect(styles).toContain("outline: 3px solid var(--thatcampus-brand)"); expect(styles).not.toMatch(/swipe|#[0-9a-f]{3,6}\b/i);
  });
});
