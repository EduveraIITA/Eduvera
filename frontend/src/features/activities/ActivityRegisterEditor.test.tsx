import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Link, MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ExecutionEnvironmentProvider } from "../simulation/ExecutionEnvironmentContext";
import { ActivityRegisterEditor } from "./ActivityRegisterEditor";
import { getActivityRegisterHistoryActivities, saveActivityMarks, submitActivityRegister, transitionActivityRegister, type ActivityRegister } from "./api";
vi.mock("./api", async (original) => ({ ...await original<typeof import("./api")>(), saveActivityMarks: vi.fn(), submitActivityRegister: vi.fn(), transitionActivityRegister: vi.fn(), getActivityRegisterHistoryActivities: vi.fn() }));
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});
afterEach(() => { cleanup(); vi.resetAllMocks(); vi.restoreAllMocks(); });
const fixture: ActivityRegister = {
  register: { id: "register-1", occurrence_id: "occurrence-1", title: "Campus safety training", kind: "training", starts_at: "2026-10-20T04:30:00Z", ends_at: "2026-10-20T05:30:00Z", time_zone: "Asia/Kolkata", place_label: "Campus hall", state: "draft", revision: 0, submitted_at: null, finalized_at: null, policy_revision: null },
  roster: [{ person_id: "learner", name: "Aarav Learner", roles: ["participant"], requirement: "required", status: null, remarks: "", observed_at: null, revision: 0 }, { person_id: "worker", name: "Ravi Guard", roles: ["participant"], requirement: "required", status: null, remarks: "", observed_at: null, revision: 0 }],
  counts: { participants: 2, recorded: 0, unrecorded: 2, present: 0, absent: 0, late: 0, excused: 0 }, capabilities: { can_record: true, can_submit: true, can_finalize: false, can_reopen: false, can_review_evidence: false }, allowed_statuses: ["present", "absent", "late", "excused"], availability_reason: null, pending_evidence: [],
};
function mount(initial: ActivityRegister = fixture, showBackButton = true) {
  const accepted = vi.fn().mockResolvedValue(undefined);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><ExecutionEnvironmentProvider environment={{ mode: "live" }}><MemoryRouter><ActivityRegisterEditor schoolId="school-1" initial={initial} onAccepted={accepted} onBack={vi.fn()} showBackButton={showBackButton} /></MemoryRouter></ExecutionEnvironmentProvider></QueryClientProvider>);
  return accepted;
}
const changedRegister = (): ActivityRegister => ({ ...fixture, register: { ...fixture.register, revision: 1 }, roster: fixture.roster.map((row, index) => ({ ...row, status: index ? "absent" : "present", revision: 1 })), counts: { ...fixture.counts, recorded: 2, unrecorded: 0, present: 1, absent: 1 } });
const withPeople = (count: number): ActivityRegister => ({ ...fixture, roster: Array.from({ length: count }, (_, index) => ({ ...fixture.roster[0]!, person_id: `person-${index + 1}`, name: `Campus person ${index + 1}` })), counts: { ...fixture.counts, participants: count, unrecorded: count } });
function Location() { return <output aria-label="Current location">{useLocation().pathname}</output>; }
describe("shared participant attendance", () => {
  it("keeps a visible attendance choice as an unsaved draft until Save is used", async () => {
    const initial = withPeople(1);
    mount(initial);
    const article = screen.getByRole("article", { name: "Campus person 1" });
    expect(screen.getByText("0 of 1 recorded")).toBeVisible();
    expect(saveActivityMarks).not.toHaveBeenCalled();
    expect(submitActivityRegister).not.toHaveBeenCalled();
    await userEvent.click(within(article).getByRole("button", { name: "Present", exact: true }));
    expect(within(article).getByRole("button", { name: "Present", exact: true })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("1 unsaved change")).toBeVisible();
    expect(saveActivityMarks).not.toHaveBeenCalled();
    expect(submitActivityRegister).not.toHaveBeenCalled();
    expect(transitionActivityRegister).not.toHaveBeenCalled();
    vi.mocked(saveActivityMarks).mockResolvedValue({ ...initial, register: { ...initial.register, revision: 1 },
      roster: [{ ...initial.roster[0]!, status: "present", revision: 1 }], counts: { ...initial.counts, recorded: 1, unrecorded: 0, present: 1 } });
    await userEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(saveActivityMarks).toHaveBeenCalledExactlyOnceWith("school-1", "register-1", 0,
      [{ person_id: "person-1", status: "present", remarks: "" }], undefined, expect.any(String)));
    expect(submitActivityRegister).not.toHaveBeenCalled();
  });
  it("blocks further draft choices while the existing save is pending", async () => {
    const initial = withPeople(1);
    let finishSave!: (register: ActivityRegister) => void;
    vi.mocked(saveActivityMarks).mockReturnValue(new Promise(resolve => { finishSave = resolve; }));
    mount(initial);
    const article = screen.getByRole("article", { name: "Campus person 1" });
    await userEvent.click(within(article).getByRole("button", { name: "Present", exact: true }));
    await userEvent.click(screen.getByRole("button", { name: "Save draft" }));
    expect(saveActivityMarks).toHaveBeenCalledTimes(1);
    const pendingArticle = screen.getByRole("article", { name: "Campus person 1" });
    expect(within(pendingArticle).getByRole("button", { name: "Absent", exact: true })).toBeDisabled();
    await userEvent.click(within(pendingArticle).getByRole("button", { name: "Absent", exact: true }));
    expect(within(pendingArticle).getByRole("button", { name: "Present", exact: true })).toHaveAttribute("aria-pressed", "true");
    expect(saveActivityMarks).toHaveBeenCalledTimes(1);
    expect(submitActivityRegister).not.toHaveBeenCalled();
    expect(transitionActivityRegister).not.toHaveBeenCalled();
    await act(async () => {
      finishSave({ ...initial, register: { ...initial.register, revision: 1 }, roster: [{ ...initial.roster[0]!, status: "present", revision: 1 }] });
      await Promise.resolve();
    });
    expect(await screen.findByText("Attendance draft saved.")).toBeVisible();
  });
  it.each([
    ["automatic_pending", "scheduled", "Automatic finalization scheduled."],
    ["review_required", "overdue", "Automatic finalization is overdue. Review this register."],
  ] as const)("keeps %s submitted and preserves its appointed reviewer's manual override", (state, reason, message) => {
    const initial = changedRegister();
    mount({ ...initial, register: { ...initial.register, state: "submitted",
      finalization: { state, reason, scheduled_at: "2026-10-20T06:00:00Z" } },
      capabilities: { ...initial.capabilities, can_finalize: true } });
    expect(screen.getByText("Submitted", { exact: true })).toBeVisible();
    expect(screen.getByText(message)).toHaveAttribute("role", "status");
    expect(screen.getByRole("button", { name: "Finalize register" })).toBeEnabled();
    expect(screen.queryByText("Final", { exact: true })).not.toBeInTheDocument();
    expect(transitionActivityRegister).not.toHaveBeenCalled();
  });
  it("keeps embedded detail focused on people and reveals provenance through History", async () => {
    mount(withPeople(25), false);
    const heading = screen.getByRole("heading", { name: "Campus safety training" });
    expect(heading).toHaveFocus();
    expect(within(heading.closest("header")!).getByText("Draft")).toBeVisible();
    expect(screen.queryByText(/Revision 0/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Back to registers" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("article")).toHaveLength(25);
    expect(screen.getByRole("button", { name: "Mark remaining present" })).toBeEnabled();
    const footer = screen.getByText("Saved").closest("footer")!;
    expect(within(footer).getAllByRole("button")).toHaveLength(1);
    expect(within(footer).getByRole("button", { name: "Submit register" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save draft" })).not.toBeInTheDocument();
    await userEvent.click(within(screen.getByRole("article", { name: "Campus person 1" })).getByRole("button", { name: "Present" }));
    expect(within(footer).getByRole("button", { name: "Save draft" })).toBeEnabled();
    expect(within(footer).getByText("1 unsaved change")).toBeVisible();
    vi.mocked(getActivityRegisterHistoryActivities).mockResolvedValue({ page: 1, page_size: 8, total: 0, total_pages: 1, activities: [] });
    await userEvent.click(screen.getByRole("button", { name: "History" }));
    expect(await within(screen.getByRole("dialog", { name: "Attendance history" })).findByText("Campus safety training · Draft")).toBeVisible();
    expect(screen.queryByText(/Revision 0/)).not.toBeInTheDocument();
    expect(saveActivityMarks).not.toHaveBeenCalled();
    expect(submitActivityRegister).not.toHaveBeenCalled();
  });
  it("keeps read-only warnings and history without an empty sticky action bar", () => {
    mount({ ...fixture, availability_reason: "This activity was cancelled. Its attendance history is retained.",
      capabilities: { can_record: false, can_submit: false, can_finalize: false, can_reopen: false, can_review_evidence: false } }, false);
    expect(screen.getByText(/This activity was cancelled/)).toBeVisible();
    expect(screen.getByRole("button", { name: "History" })).toBeEnabled();
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Submit register" })).not.toBeInTheDocument();
    expect(within(screen.getByRole("article", { name: "Ravi Guard" })).getByRole("button", { name: "Present" })).toBeDisabled();
  });
  it("puts a single participant before optional help without redundant roster tools", async () => {
    mount(withPeople(1));
    expect(screen.getByRole("article", { name: "Campus person 1" })).toBeVisible();
    expect(screen.queryByRole("searchbox", { name: "Find participant" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Filter participants" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Find & filter" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark remaining present" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "History" })).toBeVisible();
    const help = screen.getByText("Paper reports & register help");
    expect(help.closest("details")).not.toHaveAttribute("open");
    expect(screen.getByRole("button", { name: "Record a paper / late report" })).not.toBeVisible();
    await userEvent.click(help);
    expect(screen.getByRole("button", { name: "Record a paper / late report" })).toBeVisible();
    expect(screen.getByText(/Not recorded means no decision yet/)).toBeVisible();
    expect(saveActivityMarks).not.toHaveBeenCalled();
  });
  it("offers discoverable filters for a small plural roster without discarding draft marks", async () => {
    mount();
    const find = screen.getByRole("button", { name: "Find & filter" });
    expect(find).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(within(screen.getByRole("article", { name: "Ravi Guard" })).getByRole("button", { name: "Present" }));
    await userEvent.click(find);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Filter participants" }), "unrecorded");
    expect(screen.queryByRole("article", { name: "Ravi Guard" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Hide filters" }));
    expect(within(screen.getByRole("article", { name: "Ravi Guard" })).getByRole("button", { name: "Present" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("1 unsaved change")).toBeVisible();
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    expect(saveActivityMarks).not.toHaveBeenCalled();
  });
  it("automatically exposes large-roster tools and keeps drafts across finite pages and filters", async () => {
    mount(withPeople(26));
    expect(screen.getByRole("searchbox", { name: "Find participant" })).toBeVisible();
    expect(screen.getByRole("combobox", { name: "Filter participants" })).toBeVisible();
    expect(screen.getAllByRole("article")).toHaveLength(25);
    expect(screen.getByText("Page 1 of 2 · 26 participants")).toBeVisible();
    await userEvent.click(within(screen.getByRole("article", { name: "Campus person 1" })).getByRole("button", { name: "Present" }));
    await userEvent.click(screen.getByRole("button", { name: "Next", exact: true }));
    expect(screen.getAllByRole("article")).toHaveLength(1);
    await userEvent.click(within(screen.getByRole("article", { name: "Campus person 26" })).getByRole("button", { name: "Absent" }));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Filter participants" }), "unrecorded");
    expect(screen.getAllByRole("article")).toHaveLength(24);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Filter participants" }), "all");
    expect(within(screen.getByRole("article", { name: "Campus person 1" })).getByRole("button", { name: "Present" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.type(screen.getByRole("searchbox", { name: "Find participant" }), "person 26");
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(within(screen.getByRole("article", { name: "Campus person 26" })).getByRole("button", { name: "Absent" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("2 unsaved changes")).toBeVisible();
    expect(saveActivityMarks).not.toHaveBeenCalled();
  });
  it("keeps pending evidence expanded and visibly separate from accepted attendance", () => {
    const initial = { ...withPeople(1), capabilities: { ...fixture.capabilities, can_review_evidence: true }, pending_evidence: [{ id: "evidence-1", person_id: "person-1", name: "Campus person 1", claimed_status: "present" as const, capture_channel: "offline_paper", observed_at: "2026-10-20T04:40:00Z", received_at: "2026-10-20T05:40:00Z", note: "Signed paper list", source_reference: "paper-1" }] };
    mount(initial);
    const pending = screen.getByRole("heading", { name: "Reported evidence · 1" });
    expect(pending.closest("details")).toHaveAttribute("open");
    expect(screen.getByText("Reports are pending review, not accepted attendance.")).toBeVisible();
    expect(screen.getByText(/offline paper · observed/)).toBeVisible();
    expect(screen.getByText("Signed paper list")).toBeVisible();
    expect(screen.getByRole("button", { name: "Review report" })).toBeEnabled();
    expect(screen.getByText("0 of 1 recorded")).toBeVisible();
    expect(screen.getByRole("button", { name: "Submit register" })).toBeDisabled();
  });
  it("retains notes on a single participant without converting unknown attendance into present", async () => {
    const initial = withPeople(1);
    mount(initial);
    await userEvent.click(screen.getByRole("button", { name: "Add note for Campus person 1" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Attendance remark for Campus person 1" }), "Waiting for recorder verification");
    expect(screen.getByText("0 of 1 recorded")).toBeVisible();
    expect(screen.getByRole("button", { name: "Submit register" })).toBeDisabled();
    vi.mocked(saveActivityMarks).mockResolvedValue({ ...initial, register: { ...initial.register, revision: 1 }, roster: [{ ...initial.roster[0]!, remarks: "Waiting for recorder verification" }] });
    await userEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(saveActivityMarks).toHaveBeenCalledWith("school-1", "register-1", 0, [{ person_id: "person-1", status: null, remarks: "Waiting for recorder verification" }], undefined, expect.any(String)));
    expect(screen.getByRole("combobox", { name: "Attendance status for Campus person 1" })).toHaveValue("");
  });
  it("offers only allowed status choices and cannot bulk-mark a disallowed Present status", () => {
    mount({ ...fixture, allowed_statuses: ["absent", "excused"] });
    expect(screen.queryByRole("button", { name: "Present", exact: true })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mark remaining present" })).toBeDisabled();
    expect(screen.getAllByRole("combobox", { name: /Attendance status/ }).every((element) => !within(element).queryByRole("option", { name: "Present", exact: true }))).toBe(true);
  });
  it("rechecks bulk safety if recording becomes unavailable while its preview is open", async () => {
    const client = new QueryClient();
    const show = (initial: ActivityRegister) => <QueryClientProvider client={client}><ExecutionEnvironmentProvider environment={{ mode: "live" }}><MemoryRouter><ActivityRegisterEditor schoolId="school-1" initial={initial} onAccepted={vi.fn()} onBack={vi.fn()} /></MemoryRouter></ExecutionEnvironmentProvider></QueryClientProvider>;
    const view = render(show(fixture));
    await userEvent.click(screen.getByRole("button", { name: "Mark remaining present" }));
    view.rerender(show({ ...fixture, register: { ...fixture.register, revision: 1 }, capabilities: { ...fixture.capabilities, can_record: false, can_submit: false } }));
    const confirm = screen.getByRole("button", { name: "Mark 2 present in draft" });
    expect(confirm).toBeDisabled();
    await userEvent.click(confirm);
    expect(screen.getByText("0 of 2 recorded")).toBeVisible();
    expect(saveActivityMarks).not.toHaveBeenCalled();
  });
  it("protects notes from shell Back, own Back, router navigation and refresh, then releases after saving", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const registeredGuard = vi.fn<(guard: (() => boolean) | null) => void>();
    const onBack = vi.fn();
    const client = new QueryClient();
    render(<QueryClientProvider client={client}><ExecutionEnvironmentProvider environment={{ mode: "live" }}><MemoryRouter initialEntries={["/register"]}><ActivityRegisterEditor schoolId="school-1" initial={withPeople(1)} onAccepted={vi.fn()} onBack={onBack} onBeforeLeaveChange={registeredGuard} /><Link to="/elsewhere">Leave workspace</Link><Location /></MemoryRouter></ExecutionEnvironmentProvider></QueryClientProvider>);
    expect(registeredGuard.mock.lastCall?.[0]?.()).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Add note for Campus person 1" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Attendance remark for Campus person 1" }), "Awaiting confirmation");
    expect(registeredGuard.mock.lastCall?.[0]?.()).toBe(false);
    expect(confirm).toHaveBeenCalledOnce();
    confirm.mockClear();
    await userEvent.click(screen.getByRole("button", { name: "Back to registers" }));
    expect(onBack).not.toHaveBeenCalled();
    expect(confirm).toHaveBeenCalledOnce();
    confirm.mockClear();
    await userEvent.click(screen.getByRole("link", { name: "Leave workspace" }));
    expect(screen.getByLabelText("Current location")).toHaveTextContent("/register");
    expect(confirm).toHaveBeenCalledOnce();
    const dirtyUnload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(dirtyUnload);
    expect(dirtyUnload.defaultPrevented).toBe(true);
    const initial = withPeople(1);
    vi.mocked(saveActivityMarks).mockResolvedValue({ ...initial, register: { ...initial.register, revision: 1 }, roster: [{ ...initial.roster[0]!, remarks: "Awaiting confirmation" }] });
    await userEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await screen.findByText("Attendance draft saved.");
    confirm.mockClear();
    expect(registeredGuard.mock.lastCall?.[0]?.()).toBe(true);
    const cleanUnload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(cleanUnload);
    expect(cleanUnload.defaultPrevented).toBe(false);
    await userEvent.click(screen.getByRole("button", { name: "Back to registers" }));
    expect(onBack).toHaveBeenCalledOnce();
    expect(confirm).not.toHaveBeenCalled();
    cleanup();
    expect(registeredGuard).toHaveBeenLastCalledWith(null);
  });
  it("guards a reason-only draft and confirms an accepted router link only once", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const client = new QueryClient();
    render(<QueryClientProvider client={client}><ExecutionEnvironmentProvider environment={{ mode: "live" }}><MemoryRouter initialEntries={["/register"]}><ActivityRegisterEditor schoolId="school-1" initial={{ ...changedRegister(), register: { ...changedRegister().register, state: "locked" }, capabilities: { ...fixture.capabilities, can_record: false, can_reopen: true } }} onAccepted={vi.fn()} onBack={vi.fn()} /><Link to="/elsewhere">Leave workspace</Link><Location /></MemoryRouter></ExecutionEnvironmentProvider></QueryClientProvider>);
    await userEvent.type(screen.getByLabelText("Reason for reopening"), "Review requested by coordinator");
    await userEvent.click(screen.getByRole("link", { name: "Leave workspace" }));
    expect(screen.getByLabelText("Current location")).toHaveTextContent("/elsewhere");
    expect(confirm).toHaveBeenCalledOnce();
  });
  it("uses the existing browser Back guard without a second discard prompt", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const go = vi.spyOn(window.history, "go").mockImplementation(() => undefined);
    const previous = { state: window.history.state as unknown, url: window.location.href };
    window.history.replaceState({ idx: 3 }, "", "/register");
    const client = new QueryClient();
    render(<QueryClientProvider client={client}><ExecutionEnvironmentProvider environment={{ mode: "live" }}><BrowserRouter><ActivityRegisterEditor schoolId="school-1" initial={withPeople(1)} onAccepted={vi.fn()} onBack={vi.fn()} /></BrowserRouter></ExecutionEnvironmentProvider></QueryClientProvider>);
    await userEvent.click(screen.getByRole("button", { name: "Present", exact: true }));
    act(() => { window.dispatchEvent(new PopStateEvent("popstate", { state: { idx: 2 } })); });
    expect(confirm).toHaveBeenCalledOnce();
    expect(go).toHaveBeenCalledExactlyOnceWith(1);
    act(() => { window.dispatchEvent(new PopStateEvent("popstate", { state: { idx: 3 } })); });
    expect(confirm).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Present", exact: true })).toHaveAttribute("aria-pressed", "true");
    cleanup();
    window.history.replaceState(previous.state, "", previous.url);
  });
  it("describes daily attendance by its campus day without implying continuous 24-hour presence", () => {
    mount({ ...fixture, register: { ...fixture.register, title: "Workshop daily attendance", source_kind: "daily_class",
      starts_at: "2026-10-19T18:30:00Z", ends_at: "2026-10-20T18:30:00Z" } });
    expect(screen.getByText("Daily register · Oct 20, 2026 · Campus hall")).toBeVisible();
    expect(screen.queryByText(/12:00 AM/)).not.toBeInTheDocument();
    expect(saveActivityMarks).not.toHaveBeenCalled();
    expect(submitActivityRegister).not.toHaveBeenCalled();
  });
  it("refreshes a clean open register when a committed server checkpoint arrives",async()=>{
    const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
    const show=(initial:ActivityRegister)=><QueryClientProvider client={client}><ExecutionEnvironmentProvider environment={{mode:"live"}}><MemoryRouter><ActivityRegisterEditor schoolId="school-1" initial={initial} onAccepted={vi.fn()} onBack={vi.fn()}/></MemoryRouter></ExecutionEnvironmentProvider></QueryClientProvider>;
    const view=render(show({...fixture,availability_reason:"Attendance opens when this activity starts.",capabilities:{...fixture.capabilities,can_record:false,can_submit:false}}));
    expect(screen.getByText(/Attendance opens/)).toBeVisible();
    const committed={...changedRegister(),register:{...changedRegister().register,state:"submitted" as const}};
    view.rerender(show(committed));
    expect(await screen.findByText("Submitted", { exact: true })).toBeVisible();
    expect(screen.getByText("2 of 2 recorded")).toBeVisible();
    expect(screen.queryByText(/Attendance opens/)).not.toBeInTheDocument();
    expect(within(screen.getByRole("article",{name:"Ravi Guard"})).getByRole("button",{name:"Absent"})).toHaveAttribute("aria-pressed","true");
  });
  it("preserves unsaved marks and blocks stale saving when another writer advances the register",async()=>{
    const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
    const show=(initial:ActivityRegister)=><QueryClientProvider client={client}><ExecutionEnvironmentProvider environment={{mode:"live"}}><MemoryRouter><ActivityRegisterEditor schoolId="school-1" initial={initial} onAccepted={vi.fn()} onBack={vi.fn()}/></MemoryRouter></ExecutionEnvironmentProvider></QueryClientProvider>;
    const view=render(show(fixture));
    await userEvent.click(within(screen.getByRole("article",{name:"Ravi Guard"})).getByRole("button",{name:"Present"}));
    view.rerender(show(changedRegister()));
    expect(await screen.findByRole("alert")).toHaveTextContent("Your unsaved marks are preserved");
    expect(within(screen.getByRole("article",{name:"Ravi Guard"})).getByRole("button",{name:"Present"})).toHaveAttribute("aria-pressed","true");
    expect(screen.getByRole("button",{name:"Save draft"})).toBeDisabled();
    expect(screen.getByRole("button",{name:"Review latest register"})).toBeEnabled();
    expect(saveActivityMarks).not.toHaveBeenCalled();
  });
  it.each(["completed", "stopped"] as const)("keeps a %s simulation register readable without offering another write",runStatus=>{
    const client=new QueryClient();
    render(<QueryClientProvider client={client}><ExecutionEnvironmentProvider environment={{mode:"simulation",namespaceId:"sim-one",runId:"run-one",runStatus,virtualClock:{now:"2026-10-20T05:30:00Z",timeZone:"Asia/Kolkata"}}}><MemoryRouter><ActivityRegisterEditor schoolId="school-1" initial={changedRegister()} onAccepted={vi.fn()} onBack={vi.fn()}/></MemoryRouter></ExecutionEnvironmentProvider></QueryClientProvider>);
    expect(screen.getByText(/simulation has ended/)).toBeVisible();
    expect(screen.getByRole("button",{name:"Mark remaining present"})).toBeDisabled();
    expect(screen.getByRole("button",{name:"History"})).toBeEnabled();
    expect(screen.getByRole("button",{name:"Submit register"})).toBeDisabled();
    expect(within(screen.getByRole("article", { name: "Ravi Guard" })).getByRole("button", { name: "Present", exact: true })).toBeDisabled();
    expect(saveActivityMarks).not.toHaveBeenCalled();
    expect(submitActivityRegister).not.toHaveBeenCalled();
    expect(transitionActivityRegister).not.toHaveBeenCalled();
  });
  it("keeps untouched participants unknown and submits one mixed roster atomically", async () => {
    const accepted = mount();
    expect(screen.getByRole("button", { name: "Submit register" })).toBeDisabled();
    expect(screen.getAllByRole("combobox", { name: /Attendance status/ }).every((element) => (element as HTMLSelectElement).value === "")).toBe(true);
    vi.mocked(submitActivityRegister).mockResolvedValue({ ...changedRegister(), register: { ...changedRegister().register, state: "submitted", revision: 1 } });
    await userEvent.click(within(screen.getByRole("article", { name: "Aarav Learner" })).getByRole("button", { name: "Present" }));
    await userEvent.click(within(screen.getByRole("article", { name: "Ravi Guard" })).getByRole("button", { name: "Absent" }));
    await userEvent.click(screen.getByRole("button", { name: "Submit register" }));
    await waitFor(() => expect(accepted).toHaveBeenCalledTimes(1));
    expect(submitActivityRegister).toHaveBeenCalledWith("school-1", "register-1", 0, [{ person_id: "learner", status: "present", remarks: "" }, { person_id: "worker", status: "absent", remarks: "" }], undefined, expect.any(String));
    expect(saveActivityMarks).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("Register submitted");
  });
  it("previews bulk scope and marks only unrecorded participants in the local draft", async () => {
    const initial = { ...fixture, roster: fixture.roster.map((row, index) => ({ ...row, status: index ? null : "absent" as const })) };
    mount(initial);
    await userEvent.click(screen.getByRole("button", { name: "Mark remaining present" }));
    const dialog = within(screen.getByRole("dialog", { name: "Mark remaining participants present?" }));
    expect(dialog.getByText(/1 unrecorded participant/)).toBeVisible();
    expect(saveActivityMarks).not.toHaveBeenCalled();
    await userEvent.click(dialog.getByRole("button", { name: "Mark 1 present in draft" }));
    expect(within(screen.getByRole("article", { name: "Aarav Learner" })).getByRole("button", { name: "Absent" })).toHaveAttribute("aria-pressed", "true");
    expect(within(screen.getByRole("article", { name: "Ravi Guard" })).getByRole("button", { name: "Present" })).toHaveAttribute("aria-pressed", "true");
    expect(saveActivityMarks).not.toHaveBeenCalled();
  });
  it("requires a reason for replacing persisted decisions and retains it in the save command", async () => {
    const initial = changedRegister();
    mount({ ...initial, register: { ...initial.register, state: "submitted" } });
    vi.mocked(saveActivityMarks).mockResolvedValue({ ...initial, register: { ...initial.register, revision: 2 } });
    await userEvent.click(within(screen.getByRole("article", { name: "Ravi Guard" })).getByRole("button", { name: "Present" }));
    expect(screen.getByRole("button", { name: "Save correction" })).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Correction reason"), "Recorder verified arrival against the paper list");
    await userEvent.click(screen.getByRole("button", { name: "Save correction" }));
    await waitFor(() => expect(saveActivityMarks).toHaveBeenCalled());
    expect(saveActivityMarks).toHaveBeenCalledWith("school-1", "register-1", 1, [{ person_id: "worker", status: "present", remarks: "" }], "Recorder verified arrival against the paper list", expect.any(String));
  });
  it("keeps correction and finalization actions safe while the compact footer changes state", async () => {
    const initial = { ...changedRegister(), register: { ...changedRegister().register, state: "submitted" as const },
      capabilities: { ...fixture.capabilities, can_submit: false, can_finalize: true } };
    mount(initial, false);
    const footer = screen.getByText("Saved").closest("footer")!;
    expect(within(footer).getByRole("button", { name: "Finalize register" })).toBeEnabled();
    await userEvent.click(within(screen.getByRole("article", { name: "Ravi Guard" })).getByRole("button", { name: "Present" }));
    expect(within(footer).getByRole("button", { name: "Finalize register" })).toBeDisabled();
    expect(within(footer).getByRole("button", { name: "Save correction" })).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Correction reason"), "Verified with the recorder");
    const corrected = { ...initial, register: { ...initial.register, revision: 2 }, roster: initial.roster.map(row => ({ ...row, status: "present" as const })),
      counts: { ...initial.counts, present: 2, absent: 0 } };
    vi.mocked(saveActivityMarks).mockResolvedValue(corrected);
    await userEvent.click(within(footer).getByRole("button", { name: "Save correction" }));
    await waitFor(() => expect(saveActivityMarks).toHaveBeenCalledWith("school-1", "register-1", 1,
      [{ person_id: "worker", status: "present", remarks: "" }], "Verified with the recorder", expect.any(String)));
    await waitFor(() => expect(within(footer).queryByRole("button", { name: "Save correction" })).not.toBeInTheDocument());
    expect(within(footer).getByText("Saved")).toBeVisible();
    vi.mocked(transitionActivityRegister).mockResolvedValue({ ...corrected, register: { ...corrected.register, state: "locked", revision: 3 },
      capabilities: { ...corrected.capabilities, can_record: false, can_finalize: false, can_reopen: true } });
    await userEvent.click(within(footer).getByRole("button", { name: "Finalize register" }));
    await waitFor(() => expect(transitionActivityRegister).toHaveBeenCalledWith("school-1", "register-1", 2, "finalize", undefined, expect.any(String)));
    expect(await screen.findByRole("button", { name: "Reopen for correction" })).toBeDisabled();
    expect(submitActivityRegister).not.toHaveBeenCalled();
  });
  it("retains local edits on a conflict and offers the latest saved register", async () => {
    mount();
    vi.mocked(saveActivityMarks).mockRejectedValue(new Error("The register changed. Review the latest revision."));
    await userEvent.click(within(screen.getByRole("article", { name: "Ravi Guard" })).getByRole("button", { name: "Present" }));
    await userEvent.click(screen.getByRole("button", { name: "Save draft" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("register changed");
    expect(within(screen.getByRole("article", { name: "Ravi Guard" })).getByRole("button", { name: "Present" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Review latest register" })).toBeVisible();
  });
  it("uses finite history pages and does not mark participants by reading history", async () => {
    mount();
    vi.mocked(getActivityRegisterHistoryActivities).mockResolvedValue({ page: 1, page_size: 8, total: 9, total_pages: 2, activities: [{ id: "batch-1", action: "marks", actor_name: "Campus Coordinator", recorded_at: "2026-10-20T04:40:00Z", reason: null,
      people_count: 1, decision_count: 1, correction_count: 0, note_count: 0, status_counts: { present: 1 }, person_name: "Ravi Guard", previous_status: null, status: "present" }] });
    await userEvent.click(screen.getByRole("button", { name: "History" }));
    const history = within(screen.getByRole("dialog", { name: "Attendance history" }));
    expect(await history.findByText("Page 1 of 2 · 9 activities")).toBeVisible();
    await userEvent.click(history.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(getActivityRegisterHistoryActivities).toHaveBeenCalledWith("school-1", "register-1", 2));
    expect(saveActivityMarks).not.toHaveBeenCalled();
  });
});
