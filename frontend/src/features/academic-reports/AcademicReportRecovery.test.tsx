import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExecutionEnvironmentProvider } from "../simulation/ExecutionEnvironmentContext";
import type { ExecutionEnvironment } from "../simulation/executionEnvironment";
import { executionEnvironmentQueryKey } from "../simulation/executionEnvironmentQueryKey";
import { ApiError } from "../../lib/api";
import { AcademicReportWorkspacePage } from "./AcademicReportWorkspacePage";
import { WorkspaceAcademicReportsRoute } from "./AcademicReportRoutes";
import { generateReportBatch, getAcademicReportWorkspace, getGradingScheme, getReportBatch, reportBatchAction, updateReportComments, type AcademicReportWorkspace, type GradingSchemeDetail, type ReportBatchDetail, type ReportCommentUpdate } from "./api";

const actor = vi.hoisted(() => ({ id: "reviewer-1" }));
vi.mock("../auth/AuthContext", () => ({ useOptionalAuth: () => ({ user: { id: actor.id } }), useAuth: () => ({ user: { id: actor.id, active_school_id: "school-1" }, memberships: [{ school_id: "school-1", school_name: "Fictional QA" }], refresh: vi.fn() }) }));
vi.mock("../../pages/operations/OperationsShell", () => ({ OperationsShell: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("./api", async original => ({ ...await original<typeof import("./api")>(), getReportBatch: vi.fn(), getGradingScheme: vi.fn(), getAcademicReportWorkspace: vi.fn(), generateReportBatch: vi.fn(), reportBatchAction: vi.fn(), updateReportComments: vi.fn() }));

const source: ReportBatchDetail = {
  batch: { id: "batch-1", scheme_id: "scheme-1", scheme_name: "Semester one report", class_name: "BCA A", class_section_id: "class-a", term_name: "Semester one", academic_year: "2026-27", review_mode: "independent", sequence: 1, status: "draft", revision: 7, correction_reason: "", generated_at: "2026-10-20T09:00:00Z", published_at: null, learner_count: 1, incomplete_count: 0, review_note: "", publication_note: "" },
  students: [{ id: "report-student-1", student_id: "student-1", first_name: "Sana", last_name: "Audit", admission_number: "QA-1", roll_number: 1, outcome: "complete", overall_percentage: "80.00", overall_grade: "A", class_teacher_comment: "Saved teacher remark", principal_comment: "Saved principal remark", comment_revision: 3 }],
  subjects: [], components: [],
};
const workspace: AcademicReportWorkspace = { mode: "admin", schemes: [], batches: [source.batch], references: { terms: [], classes: [], subjects: [], assessments: [] } };
const live: ExecutionEnvironment = { mode: "live" };
const simulation: ExecutionEnvironment = { mode: "simulation", namespaceId: "scenario:qa:run:one", runId: "one", runStatus: "running", virtualClock: { now: "2026-10-27T09:00:00Z", timeZone: "UTC" } };
const key = (environment = live, actorId = actor.id) => executionEnvironmentQueryKey(environment, ["report-batch", "school-1", "actor", actorId, "batch-1"]);
function view(client: QueryClient, environment = live) {
  return <QueryClientProvider client={client}><ExecutionEnvironmentProvider environment={environment}><MemoryRouter initialEntries={["/areas/reports/remarks?batch=batch-1"]}><AcademicReportWorkspacePage schoolId="school-1" data={workspace} refresh={vi.fn().mockResolvedValue(undefined)} /></MemoryRouter></ExecutionEnvironmentProvider></QueryClientProvider>;
}
async function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rendered = render(view(client));
  fireEvent.click(await screen.findByRole("button", { name: /Sana Audit/ }));
  return { client, rendered };
}
const remark = () => screen.getByRole("textbox", { name: "Class teacher remark" });
const note = () => screen.getByRole("textbox", { name: "Review or publication note" });
const edit = () => fireEvent.change(remark(), { target: { value: "My unsaved remark" } });
const saved: ReportCommentUpdate = { id: "report-student-1", student_id: "student-1", class_teacher_comment: "My unsaved remark", principal_comment: "Saved principal remark", comment_revision: 4, batch_revision: 8 };

beforeEach(() => {
  actor.id = "reviewer-1";
  vi.mocked(getReportBatch).mockReset().mockResolvedValue(source);
  vi.mocked(updateReportComments).mockReset();
  vi.mocked(reportBatchAction).mockReset();
  vi.mocked(getGradingScheme).mockReset();
  vi.mocked(getAcademicReportWorkspace).mockReset();
  vi.mocked(generateReportBatch).mockReset();
});

describe("confirmed report generation recovery", () => {
  const scheme: GradingSchemeDetail = {
    scheme: { id: "scheme-1", term_id: "term-1", class_section_id: "class-a", name: "Semester report", code: "SEM", status: "active", absence_treatment: "incomplete", review_mode: "independent", revision: 2, term_name: "Semester one", academic_year: "2026-27", class_name: "BCA A", subject_count: 1, report_count: 1 },
    bands: [], subjects: [], components: [],
  };
  it.each(["workspace", "scheme"] as const)("does not generate twice after the release is accepted and %s readback fails", async failure => {
    const data: AcademicReportWorkspace = { ...workspace, schemes: [scheme.scheme] };
    vi.mocked(getAcademicReportWorkspace).mockResolvedValue(data);
    vi.mocked(getGradingScheme).mockResolvedValue(scheme);
    vi.mocked(generateReportBatch).mockResolvedValue({ ...source.batch, id: "batch-2", sequence: 2 });
    vi.mocked(getReportBatch).mockResolvedValue({ ...source, batch: { ...source.batch, id: "batch-2", sequence: 2 } });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><ExecutionEnvironmentProvider environment={live}><MemoryRouter initialEntries={["/areas/reports/remarks?scheme=scheme-1"]}><WorkspaceAcademicReportsRoute /></MemoryRouter></ExecutionEnvironmentProvider></QueryClientProvider>);
    const reason = await screen.findByRole("textbox", { name: "Correction reason" });
    fireEvent.change(reason, { target: { value: "Corrected source marks after review" } });
    if (failure === "workspace") vi.mocked(getAcademicReportWorkspace).mockRejectedValueOnce(new Error("Workspace readback unavailable"));
    else vi.mocked(getGradingScheme).mockRejectedValueOnce(new Error("Scheme readback unavailable"));
    fireEvent.click(screen.getByRole("button", { name: "Generate correction" }));
    expect(await screen.findByText("Report release created. The latest workspace couldn’t be refreshed.")).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("Release 2 created.");
    expect(screen.getByRole("textbox", { name: "Correction reason" })).toHaveValue("Corrected source marks after review");
    expect(screen.getByRole("textbox", { name: "Correction reason" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Generate correction" })).not.toBeInTheDocument();
    expect(screen.getByText(failure === "workspace" ? "Couldn’t refresh the report workspace" : "Couldn’t refresh this grading scheme")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Retry refresh" }));
    await waitFor(() => expect(screen.queryByText("Report release created. The latest workspace couldn’t be refreshed.")).not.toBeInTheDocument());
    expect(generateReportBatch).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "Generate correction" })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Correction reason" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Open release" }));
    await waitFor(() => expect(getReportBatch).toHaveBeenCalledWith("school-1", "batch-2"));
    expect(generateReportBatch).toHaveBeenCalledOnce();
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("report remarks and review recovery", () => {
  it("keeps drafts through filtering and waits for the confirmed remark before review", async () => {
    let resolve!: (result: ReportCommentUpdate) => void;
    vi.mocked(updateReportComments).mockReturnValueOnce(new Promise(done => { resolve = done; }));
    await mount(); edit();
    fireEvent.change(note(), { target: { value: "Reviewed complete release" } });
    expect(screen.getByRole("button", { name: "Review batch" })).toBeDisabled();
    fireEvent.change(screen.getByRole("searchbox", { name: "Learners" }), { target: { value: "Nobody" } });
    expect(screen.getByText("No learners match this search.")).toBeVisible();
    fireEvent.change(screen.getByRole("searchbox", { name: "Learners" }), { target: { value: "Sana" } });
    fireEvent.click(screen.getByRole("button", { name: /Sana Audit/ }));
    expect(remark()).toHaveValue("My unsaved remark");
    fireEvent.click(screen.getByRole("button", { name: "Save remarks" }));
    expect(remark()).toBeDisabled();
    expect(screen.getByRole("button", { name: "Review batch" })).toBeDisabled();
    expect(updateReportComments).toHaveBeenCalledWith("school-1", "batch-1", "student-1", { expected_revision: 3, expected_batch_revision: 7, class_teacher_comment: "My unsaved remark", principal_comment: "Saved principal remark" });
    vi.mocked(getReportBatch).mockResolvedValue({ ...source, batch: { ...source.batch, revision: 8 }, students: [{ ...source.students[0]!, ...saved }] });
    await act(async () => { resolve(saved); await Promise.resolve(); });
    await waitFor(() => expect(screen.getByRole("button", { name: "Review batch" })).toBeEnabled());
    expect(note()).toHaveValue("Reviewed complete release");
    expect(updateReportComments).toHaveBeenCalledOnce();
    expect(reportBatchAction).not.toHaveBeenCalled();
  });

  it("keeps a changed-source draft until the person explicitly uses the saved remarks", async () => {
    const { client } = await mount(); edit();
    remark().focus();
    await act(async () => { client.setQueryData(key(), { ...source, batch: { ...source.batch, revision: 8 }, students: [{ ...source.students[0]!, class_teacher_comment: "Another reviewer’s remark", comment_revision: 4 }] }); await Promise.resolve(); });
    expect(remark()).toHaveValue("My unsaved remark");
    await waitFor(() => expect(screen.getByRole("button", { name: "Save remarks" })).toBeDisabled());
    expect(remark()).toHaveFocus();
    expect(screen.getByRole("alert")).toHaveTextContent("unsaved remarks have not been applied");
    fireEvent.click(screen.getByRole("button", { name: "Use saved remarks" }));
    expect(remark()).toHaveValue("Another reviewer’s remark");
    expect(updateReportComments).not.toHaveBeenCalled();
  });

  it("retains but locks unsubmitted remarks when a release is reviewed elsewhere", async () => {
    const { client } = await mount(); edit();
    await act(async () => { client.setQueryData(key(), { ...source, batch: { ...source.batch, status: "reviewed", revision: 8 } }); await Promise.resolve(); });
    expect(remark()).toHaveValue("My unsaved remark");
    await waitFor(() => expect(remark()).toBeDisabled());
    expect(screen.getByRole("button", { name: "Publish reports" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Use saved remarks" }));
    expect(screen.queryByRole("textbox", { name: "Class teacher remark" })).not.toBeInTheDocument();
    expect(screen.getByText("Saved teacher remark")).toBeVisible();
  });

  it("retains the editor when a background read fails and recovers with retry", async () => {
    const { client } = await mount(); edit();
    vi.mocked(getReportBatch).mockRejectedValueOnce(new Error("Temporarily offline"));
    await act(async () => { await client.refetchQueries({ queryKey: key() }); });
    expect(await screen.findByText("Couldn’t refresh this report release")).toBeVisible();
    expect(remark()).toHaveValue("My unsaved remark");
    expect(remark()).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(remark()).toBeEnabled());
    expect(remark()).toHaveValue("My unsaved remark");
  });

  it("keeps a refused save and its revision without applying the draft", async () => {
    vi.mocked(updateReportComments).mockRejectedValueOnce(new Error("This release changed. Refresh before saving remarks."));
    await mount(); edit();
    fireEvent.click(screen.getByRole("button", { name: "Save remarks" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("release changed");
    expect(remark()).toHaveValue("My unsaved remark");
    expect(updateReportComments).toHaveBeenCalledOnce();
  });

  it("hides cached report data when current access is revoked", async () => {
    const { client } = await mount(); edit();
    vi.mocked(getReportBatch).mockRejectedValueOnce(new ApiError("Report access ended", 403));
    await act(async () => { await client.refetchQueries({ queryKey: key() }); });
    expect(await screen.findByRole("alert")).toHaveTextContent("Report access ended");
    expect(screen.queryByText("Sana Audit")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Class teacher remark" })).not.toBeInTheDocument();
  });

  it("does not overwrite a newer cached revision with an older accepted response", async () => {
    let resolve!: (result: ReportCommentUpdate) => void;
    vi.mocked(updateReportComments).mockReturnValueOnce(new Promise(done => { resolve = done; }));
    const { client } = await mount(); edit();
    fireEvent.click(screen.getByRole("button", { name: "Save remarks" }));
    const latest: ReportBatchDetail = { ...source, batch: { ...source.batch, revision: 10 }, students: [{ ...source.students[0]!, class_teacher_comment: "Newer accepted remark", comment_revision: 5 }] };
    vi.mocked(getReportBatch).mockResolvedValue(latest);
    await act(async () => { client.setQueryData(key(), latest); resolve(saved); await Promise.resolve(); });
    await waitFor(() => expect(remark()).toHaveValue("Newer accepted remark"));
    expect(client.getQueryData<ReportBatchDetail>(key())?.batch.revision).toBe(10);
  });

  it("distinguishes a confirmed save from a failed readback and retains accepted values", async () => {
    vi.mocked(updateReportComments).mockResolvedValueOnce(saved);
    await mount(); edit();
    vi.mocked(getReportBatch).mockRejectedValue(new Error("Readback unavailable"));
    fireEvent.click(screen.getByRole("button", { name: "Save remarks" }));
    await waitFor(() => expect(screen.getAllByRole("alert").some(element => element.textContent?.includes("Remarks saved."))).toBe(true));
    expect(remark()).toHaveValue("My unsaved remark");
    expect(screen.queryByRole("button", { name: "Discard changes" })).not.toBeInTheDocument();
    expect(updateReportComments).toHaveBeenCalledOnce();
  });

  it("does not silently reuse a review note for a changed release", async () => {
    const { client } = await mount();
    fireEvent.change(note(), { target: { value: "Reviewed the original release" } });
    await act(async () => { client.setQueryData(key(), { ...source, batch: { ...source.batch, revision: 8 } }); await Promise.resolve(); });
    expect(note()).toHaveValue("Reviewed the original release");
    await waitFor(() => expect(screen.getByRole("button", { name: "Review batch" })).toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Use latest release" }));
    expect(note()).toHaveValue("");
    expect(reportBatchAction).not.toHaveBeenCalled();
  });

  it("partitions reads and removes local drafts across actors and worlds", async () => {
    const { client, rendered } = await mount(); edit();
    actor.id = "another-reviewer";
    rendered.rerender(view(client));
    await waitFor(() => expect(getReportBatch).toHaveBeenCalledTimes(2));
    fireEvent.click(await screen.findByRole("button", { name: /Sana Audit/ }));
    expect(remark()).toHaveValue("Saved teacher remark");
    rendered.rerender(view(client, simulation));
    await waitFor(() => expect(getReportBatch).toHaveBeenCalledTimes(3));
    expect(client.getQueryCache().find({ queryKey: key(live, "reviewer-1") })).toBeDefined();
    expect(client.getQueryCache().find({ queryKey: key(live, "another-reviewer") })).toBeDefined();
    expect(client.getQueryCache().find({ queryKey: key(simulation, "another-reviewer") })).toBeDefined();
    expect(updateReportComments).not.toHaveBeenCalled();
  });

  it("ignores late accepted remarks after the current actor changes", async () => {
    let resolve!: (result: ReportCommentUpdate) => void;
    vi.mocked(updateReportComments).mockReturnValueOnce(new Promise(done => { resolve = done; }));
    const { client, rendered } = await mount(); edit();
    fireEvent.click(screen.getByRole("button", { name: "Save remarks" }));
    actor.id = "another-reviewer";
    rendered.rerender(view(client));
    await waitFor(() => expect(getReportBatch).toHaveBeenCalledTimes(2));
    await act(async () => { resolve(saved); await Promise.resolve(); });
    expect(client.getQueryData<ReportBatchDetail>(key(live, "reviewer-1"))?.batch.revision).toBe(7);
    expect(client.getQueryData<ReportBatchDetail>(key(live, "another-reviewer"))?.batch.revision).toBe(7);
    expect(getReportBatch).toHaveBeenCalledTimes(2);
  });

  it("keeps a stopped or unavailable simulation read-only without borrowing another world", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const rendered = render(view(client, { ...simulation, runStatus: "stopped" }));
    fireEvent.click(await screen.findByRole("button", { name: /Sana Audit/ }));
    expect(remark()).toBeDisabled();
    expect(screen.getByRole("button", { name: "Review batch" })).toBeDisabled();
    const calls = vi.mocked(getReportBatch).mock.calls.length;
    rendered.rerender(view(client, { mode: "simulation", unavailable: true, namespaceId: "scenario:lost:run:lost", runId: "lost", unavailableReason: "authorization_lost" }));
    expect(screen.getByRole("alert")).toHaveTextContent("simulation is unavailable");
    expect(getReportBatch).toHaveBeenCalledTimes(calls);
    expect(updateReportComments).not.toHaveBeenCalled();
  });
});
