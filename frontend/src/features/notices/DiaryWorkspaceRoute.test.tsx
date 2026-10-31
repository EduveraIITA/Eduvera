import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiDiaryItem, ApiStudent, ParentDiaryResponse, StudentDiaryResponse } from "../school/api";
import {
  acknowledgeDiary,
  addDiaryNote,
  getParentDiary,
  getStudentDiary,
  setHomeworkCompleted,
} from "../school/api";
import type { ExecutionEnvironment } from "../simulation/executionEnvironment";
import type { WorkspaceManifest } from "../workspace/types";
import { useWorkspaceManifest } from "../workspace/useWorkspaceManifest";
import { WorkspaceDiaryRoute, diaryContextOptions } from "./DiaryWorkspaceRoute";

vi.mock("../../pages/operations/OperationsShell", () => ({
  OperationsShell: ({ title, children }: { title: string; children: ReactNode }) => <main><h1>{title}</h1>{children}</main>,
}));

const environment = vi.hoisted((): { current: ExecutionEnvironment } => ({ current: { mode: "live", namespaceId: "live-cis" } }));
vi.mock("../simulation/ExecutionEnvironmentContext", () => ({ useExecutionEnvironment: () => environment.current }));

vi.mock("../workspace/useWorkspaceManifest", () => ({
  useWorkspaceManifest: vi.fn(),
}));

vi.mock("../school/api", async (original) => {
  const actual = await original<typeof import("../school/api")>();
  return {
    ...actual,
    acknowledgeDiary: vi.fn().mockResolvedValue({}),
    addDiaryNote: vi.fn().mockResolvedValue({}),
    getParentDiary: vi.fn(),
    getStudentDiary: vi.fn(),
    setHomeworkCompleted: vi.fn().mockResolvedValue({}),
  };
});

const student = (id: string, name: string): ApiStudent => ({
  id,
  user: { id: `${id}-account`, display_name: name },
  admission_number: `ADM-${id}`,
  avatar_url: "",
  current_enrollment: {
    class_name: "Class 6A",
    grade: "6",
    section: "A",
    board: "CBSE",
    room_number: "201",
    roll_number: 4,
    term: { name: "Term 1", academic_year: "2026–27", starts_on: "2026-04-01", ends_on: "2027-03-31" },
  },
});

const diaryItem: ApiDiaryItem = {
  id: "diary-1",
  date: "2026-10-20",
  item_type: "homework",
  item_type_label: "Homework",
  subject: { id: "mathematics", name: "Mathematics", short_name: "Maths" },
  title: "Bring geometry workbook",
  body: "Pack the geometry workbook for tomorrow.",
  author_name: "Kavita Mehta",
  due_at: "2026-10-21T09:00:00.000Z",
  requires_acknowledgement: true,
  acknowledged: false,
  completed: false,
  completed_at: null,
  published_at: "2026-10-20T08:00:00.000Z",
  notes: [],
};

const manifest: WorkspaceManifest = {
  revision: "diary-workspace-1",
  generated_at: "2026-10-18T12:00:00.000Z",
  context: {
    institution_id: "cis",
    institution_label: "Cambridge International School",
    environment: { kind: "live", namespace_id: "live-cis" },
  },
  today: { now: [], attention: { total: 0, overdue: 0, due_soon: 0 }, next: [] },
  work: { total: 0, items: [] },
  areas: [{
    key: "messages",
    label: "Messages",
    href: "/areas/messages",
    capabilities: ["messages.view"],
    scopes: [{ kind: "self", id: "student-self", label: "My records" }],
    surfaces: [{
      key: "diary:self:student-self",
      label: "My diary",
      description: "Published learning updates",
      href: "/areas/messages/diary?scope=self&student_id=student-self",
      capabilities: ["messages.view"],
      scopes: [{ kind: "self", id: "student-self", label: "My records" }],
    }, {
      key: "diary:dependent:aarav",
      label: "Aarav's diary",
      description: "Published learning updates for Aarav",
      href: "/areas/messages/diary?scope=dependent&student_id=aarav",
      capabilities: ["messages.view"],
      scopes: [{ kind: "dependent", id: "aarav", label: "Aarav Sharma" }],
    }],
  }],
  more: { setup: [], other: [] },
  freshness: { state: "current", as_of: "12:00 PM", source_revision: "diary-1" },
};

function show(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>
    <MemoryRouter initialEntries={[path]}><WorkspaceDiaryRoute /></MemoryRouter>
  </QueryClientProvider>);
}

beforeEach(() => {
  environment.current = { mode: "live", namespaceId: "live-cis" };
  vi.mocked(useWorkspaceManifest).mockReturnValue({
    data: manifest,
    error: null,
    isPending: false,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useWorkspaceManifest>);
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.clearAllMocks();
});

describe("responsibility-composed Diary workspace", () => {
  it("derives only explicit self and dependent relationships from the manifest", () => {
    expect(diaryContextOptions(manifest.areas[0]!)).toEqual([
      expect.objectContaining({ key: "diary:self:student-self", scope: "self", studentId: "student-self" }),
      expect.objectContaining({ key: "diary:dependent:aarav", scope: "dependent", studentId: "aarav" }),
    ]);
  });

  it("loads the exact dependent record and keeps completion separate from acknowledgement and notes", async () => {
    vi.mocked(getParentDiary).mockResolvedValue({
      student: student("aarav", "Aarav Sharma"),
      date: "2026-10-20",
      items: [diaryItem],
      schedule: [],
    } satisfies ParentDiaryResponse);
    show("/areas/messages/diary?scope=dependent&student_id=aarav&date=2026-10-20");

    expect(await screen.findByRole("button", { name: "Open Bring geometry workbook" })).toBeInTheDocument();
    expect(getParentDiary).toHaveBeenCalledWith("2026-10-20", "aarav");
    fireEvent.click(screen.getByRole("button", { name: "Open Bring geometry workbook" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Add a private note or question" }), { target: { value: "Please confirm the required pages." } });
    fireEvent.click(screen.getByRole("button", { name: "Send note" }));
    await waitFor(() => expect(addDiaryNote).toHaveBeenCalledWith("diary-1", "aarav", "Please confirm the required pages.", expect.any(Object)));

    fireEvent.click(screen.getByRole("button", { name: "Open Bring geometry workbook" }));
    fireEvent.click(screen.getByRole("button", { name: "Mark homework done" }));
    await waitFor(() => expect(setHomeworkCompleted).toHaveBeenCalledWith("diary-1", "aarav", true, expect.any(Object)));
    expect(acknowledgeDiary).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("button", { name: "Acknowledge update" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Acknowledge update" }));
    await waitFor(() => expect(acknowledgeDiary).toHaveBeenCalledWith("diary-1", "aarav"));
  });

  it("does not label acknowledged homework Done or remove its completion action", async () => {
    vi.mocked(getStudentDiary).mockResolvedValue({ student: student("student-self", "Ishaan Rao"), date_from: diaryItem.date,
      date_to: diaryItem.date, items: [{ ...diaryItem, acknowledged: true }] });
    show("/areas/messages/diary?scope=self&student_id=student-self");

    const entry = await screen.findByRole("button", { name: "Open Bring geometry workbook" });
    expect(entry).toHaveTextContent("To do");
    expect(entry).toHaveTextContent("Acknowledged");
    expect(entry).not.toHaveTextContent("Done");
    expect(screen.getByRole("button", { name: "Needs action 1" })).toBeInTheDocument();
    fireEvent.click(entry);
    expect(screen.getByRole("button", { name: "Mark homework done" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Acknowledged" })).toBeDisabled();
  });

  it("lets a learner complete homework even when no acknowledgement is required, then reopen it", async () => {
    const response: StudentDiaryResponse = { student: student("student-self", "Ishaan Rao"), date_from: diaryItem.date,
      date_to: diaryItem.date, items: [{ ...diaryItem, requires_acknowledgement: false }] };
    vi.mocked(getStudentDiary).mockResolvedValue(response);
    show("/areas/messages/diary?scope=self&student_id=student-self");
    fireEvent.click(await screen.findByRole("button", { name: "Open Bring geometry workbook" }));
    expect(screen.queryByRole("button", { name: "Acknowledge update" })).not.toBeInTheDocument();
    vi.mocked(getStudentDiary).mockResolvedValue({ ...response, items: [{ ...response.items[0]!, completed: true, completed_at: "2026-10-20T10:00:00Z" }] });
    fireEvent.click(screen.getByRole("button", { name: "Mark homework done" }));
    await waitFor(() => expect(setHomeworkCompleted).toHaveBeenCalledWith("diary-1", "student-self", true, expect.any(Object)));
    expect(await screen.findByRole("button", { name: "Mark as not done" })).toBeEnabled();
    expect(screen.getByRole("status")).toHaveTextContent("Done");
    vi.mocked(getStudentDiary).mockResolvedValue(response);
    fireEvent.click(screen.getByRole("button", { name: "Mark as not done" }));
    await waitFor(() => expect(setHomeworkCompleted).toHaveBeenLastCalledWith("diary-1", "student-self", false, expect.any(Object)));
    expect(await screen.findByText("Not done yet")).toBeInTheDocument();
    expect(acknowledgeDiary).not.toHaveBeenCalled();
  });

  it("keeps a required acknowledgement outstanding after homework is done", async () => {
    vi.mocked(getStudentDiary).mockResolvedValue({ student: student("student-self", "Ishaan Rao"), date_from: diaryItem.date,
      date_to: diaryItem.date, items: [{ ...diaryItem, completed: true, completed_at: "2026-10-20T10:00:00Z" }] });
    show("/areas/messages/diary?scope=self&student_id=student-self");
    const entry = await screen.findByRole("button", { name: "Open Bring geometry workbook" });
    expect(entry).toHaveTextContent("Done");
    expect(entry).toHaveTextContent("Acknowledge");
    fireEvent.click(screen.getByRole("button", { name: "Needs action 1" }));
    expect(entry).toBeInTheDocument();
    fireEvent.click(entry);
    expect(screen.getByRole("button", { name: "Acknowledge update" })).toBeEnabled();
  });

  it("labels a non-homework acknowledgement as Acknowledged, never Done", async () => {
    vi.mocked(getStudentDiary).mockResolvedValue({ student: student("student-self", "Ishaan Rao"), date_from: diaryItem.date,
      date_to: diaryItem.date, items: [{ ...diaryItem, item_type: "announcement", item_type_label: "Announcement", acknowledged: true,
        completed: null }] });
    show("/areas/messages/diary?scope=self&student_id=student-self");
    const entry = await screen.findByRole("button", { name: "Open Bring geometry workbook" });
    expect(entry).toHaveTextContent("Acknowledged");
    expect(entry).not.toHaveTextContent("Done");
    fireEvent.click(entry);
    expect(screen.queryByRole("button", { name: "Mark homework done" })).not.toBeInTheDocument();
  });

  it("keeps failed homework changes open without acknowledging or showing false completion", async () => {
    vi.mocked(getStudentDiary).mockResolvedValue({ student: student("student-self", "Ishaan Rao"), date_from: diaryItem.date,
      date_to: diaryItem.date, items: [diaryItem] });
    vi.mocked(setHomeworkCompleted).mockRejectedValueOnce(new Error("Your access changed. Reload this record."));
    show("/areas/messages/diary?scope=self&student_id=student-self");
    fireEvent.click(await screen.findByRole("button", { name: "Open Bring geometry workbook" }));
    fireEvent.click(screen.getByRole("button", { name: "Mark homework done" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Your access changed");
    expect(screen.getByText("Not done yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mark homework done" })).toBeEnabled();
    expect(acknowledgeDiary).not.toHaveBeenCalled();
  });

  it("locks duplicate actions and dismissal while a completion is pending", async () => {
    vi.mocked(getStudentDiary).mockResolvedValue({ student: student("student-self", "Ishaan Rao"), date_from: diaryItem.date,
      date_to: diaryItem.date, items: [diaryItem] });
    let finish!: () => void;
    vi.mocked(setHomeworkCompleted).mockReturnValueOnce(new Promise(resolve => { finish = () => resolve({}); }));
    show("/areas/messages/diary?scope=self&student_id=student-self");
    fireEvent.click(await screen.findByRole("button", { name: "Open Bring geometry workbook" }));
    fireEvent.click(screen.getByRole("button", { name: "Mark homework done" }));
    expect(screen.getByRole("button", { name: "Mark homework done" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Acknowledge update" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Close diary update" })).toBeDisabled();
    finish();
    await waitFor(() => expect(screen.getByRole("button", { name: "Close diary update" })).toBeEnabled());
    expect(setHomeworkCompleted).toHaveBeenCalledTimes(1);
  });

  it("retains an unsent learner question when closing is cancelled", async () => {
    const confirm=vi.spyOn(window,"confirm").mockReturnValue(false);
    vi.mocked(getStudentDiary).mockResolvedValue({student:student("student-self","Ishaan Rao"),date_from:diaryItem.date,date_to:diaryItem.date,items:[diaryItem]});
    show("/areas/messages/diary?scope=self&student_id=student-self");
    fireEvent.click(await screen.findByRole("button",{name:"Open Bring geometry workbook"}));
    fireEvent.change(screen.getByRole("textbox",{name:"Add a private note or question"}),{target:{value:"Which workbook page?"}});
    fireEvent.click(screen.getByRole("button",{name:"Close diary update"}));
    expect(confirm).toHaveBeenCalledOnce();expect(screen.getByRole("textbox",{name:"Add a private note or question"})).toHaveValue("Which workbook page?");
    expect(addDiaryNote).not.toHaveBeenCalled();confirm.mockRestore();
  });

  it.each(["completed","stopped"] as const)("prevents learner mutations in a %s Simulation while retaining the record",async runStatus=>{
    environment.current={mode:"simulation",namespaceId:"world-a",runId:"run-a",runStatus,virtualClock:{now:"2026-10-20T10:00:00Z",timeZone:"Asia/Kolkata"}};
    vi.mocked(useWorkspaceManifest).mockReturnValue({data:{...manifest,context:{...manifest.context,environment:{kind:"simulation",namespace_id:"world-a"}}},error:null,isPending:false,refetch:vi.fn()} as unknown as ReturnType<typeof useWorkspaceManifest>);
    vi.mocked(getStudentDiary).mockResolvedValue({student:student("student-self","Ishaan Rao"),date_from:diaryItem.date,date_to:diaryItem.date,items:[diaryItem]});
    show("/areas/messages/diary?scope=self&student_id=student-self");fireEvent.click(await screen.findByRole("button",{name:"Open Bring geometry workbook"}));
    expect(screen.getByRole("button",{name:"Mark homework done"})).toBeDisabled();expect(screen.getByRole("button",{name:"Acknowledge update"})).toBeDisabled();expect(screen.getByRole("button",{name:"Send note"})).toBeDisabled();
    expect(setHomeworkCompleted).not.toHaveBeenCalled();expect(addDiaryNote).not.toHaveBeenCalled();expect(acknowledgeDiary).not.toHaveBeenCalled();
  });

  it("does not invent an unfinished status when completion evidence is unavailable", async () => {
    vi.mocked(getStudentDiary).mockResolvedValue({ student: student("student-self", "Ishaan Rao"), date_from: diaryItem.date,
      date_to: diaryItem.date, items: [{ ...diaryItem, completed: null, requires_acknowledgement: false }] });
    show("/areas/messages/diary?scope=self&student_id=student-self");
    fireEvent.click(await screen.findByRole("button", { name: "Open Bring geometry workbook" }));
    expect(screen.getByRole("button", { name: "Mark homework done" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Homework status unavailable");
    expect(screen.getByRole("button", { name: "Needs action 0" })).toBeInTheDocument();
  });

  it("uses the same completion action in the exact selected Simulation world", async () => {
    environment.current = { mode: "simulation", namespaceId: "world-a", runId: "run-a",
      virtualClock: { now: "2026-10-20T10:00:00Z", timeZone: "Asia/Kolkata" } };
    vi.mocked(useWorkspaceManifest).mockReturnValue({ data: { ...manifest,
      context: { ...manifest.context, environment: { kind: "simulation", namespace_id: "world-a" } } }, error: null,
      isPending: false, refetch: vi.fn() } as unknown as ReturnType<typeof useWorkspaceManifest>);
    vi.mocked(getStudentDiary).mockResolvedValue({ student: student("student-self", "Ishaan Rao"), date_from: diaryItem.date,
      date_to: diaryItem.date, items: [diaryItem] });
    show("/areas/messages/diary?scope=self&student_id=student-self");
    fireEvent.click(await screen.findByRole("button", { name: "Open Bring geometry workbook" }));
    fireEvent.click(screen.getByRole("button", { name: "Mark homework done" }));
    await waitFor(() => expect(setHomeworkCompleted).toHaveBeenCalledWith("diary-1", "student-self", true, expect.any(Object)));
    await waitFor(() => expect(screen.getByRole("button", { name: "Mark homework done" })).toBeEnabled());
  });

  it.each(["mismatch", "unavailable"])("does not load diary data in a %s selected world", (state) => {
    environment.current = state === "unavailable"
      ? { mode: "simulation", namespaceId: "world-a", runId: "run-a", unavailable: true, unavailableReason: "run_unavailable" }
      : { mode: "simulation", namespaceId: "world-a", runId: "run-a", virtualClock: { now: "2026-10-20T10:00:00Z", timeZone: "Asia/Kolkata" } };
    show("/areas/messages/diary?scope=self&student_id=student-self");
    expect(getParentDiary).not.toHaveBeenCalled();
    expect(getStudentDiary).not.toHaveBeenCalled();
    expect(setHomeworkCompleted).not.toHaveBeenCalled();
  });

  it("loads a self relationship without guessing a parent-style scope", async () => {
    vi.mocked(getStudentDiary).mockResolvedValue({
      student: student("student-self", "Ishaan Rao"),
      date_from: "2026-10-11",
      date_to: "2026-10-25",
      items: [diaryItem],
    } satisfies StudentDiaryResponse);
    show("/areas/messages/diary?scope=self&student_id=student-self");

    expect(await screen.findByText("Bring geometry workbook")).toBeInTheDocument();
    expect(getStudentDiary).toHaveBeenCalledTimes(1);
    expect(getParentDiary).not.toHaveBeenCalled();
  });

  it("fails closed before loading data for an unauthorized relationship", () => {
    show("/areas/messages/diary?scope=dependent&student_id=unknown");

    expect(screen.getByRole("heading", { name: "Your workspace access changed" })).toBeInTheDocument();
    expect(getParentDiary).not.toHaveBeenCalled();
    expect(getStudentDiary).not.toHaveBeenCalled();
  });
});
