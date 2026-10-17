import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExamDayPanel } from "./ExamDayPanel";
import { createExamIncident, respondToInvigilation, saveExamAttendance, type ExamOperation } from "./api";

vi.mock("./api", async (original) => ({
  ...await original<typeof import("./api")>(),
  createExamIncident: vi.fn(),
  examOperationAction: vi.fn(),
  resolveExamIncident: vi.fn(),
  respondToInvigilation: vi.fn(),
  saveExamAttendance: vi.fn(),
}));

const operation: ExamOperation = {
  sitting: { id: "sitting-1", state: "in_progress", revision: 7, space_id: "hall-1", starts_at: "2026-10-16T03:30:00.000Z", ends_at: "2026-10-16T06:30:00.000Z" },
  space: { id: "hall-1", name: "Main hall", code: "HALL-1", kind: "auditorium", capacity: 60, campus_name: "Cambridge campus" },
  invigilators: [{ id: "assignment-1", user_id: "teacher-1", username:"meera.teacher", name: "Meera Kapoor", avatar_url: null, status: "accepted", response_note: "", revision: 2 }],
  viewer_assignment: null,
  candidates: [
    { student_id: "student-1", name: "Aarav Sharma", admission_number: "CIS-001", roll_number_snapshot: 1, avatar_url: null, attendance_status: "absent", observed_at: "2026-10-16T03:35:00.000Z", attendance_note: "", attendance_revision: 2 },
    { student_id: "student-2", name: "Zara Sinha", admission_number: "CIS-002", roll_number_snapshot: 2, avatar_url: null, attendance_status: "unrecorded", observed_at: null, attendance_note: "", attendance_revision: 1 },
  ],
  incidents: [],
  attendance_counts: { total: 2, unrecorded: 1, present: 0, late: 0, absent: 1, left_early: 0 },
  policy: { readiness_minutes_before: 30, attendance_close_after_minutes: 15, minimum_invigilators: 1, require_all_candidate_attendance: true, post_completion_marking_mode: "manual", revision: 1 },
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("exam-day panel", () => {
  it("explains effective timetable conflicts before an administrator schedules the exam", () => {
    const planning: ExamOperation = {
      ...operation,
      sitting: { ...operation.sitting, state: "planning" },
      candidates: [],
      attendance_counts: { total: 0, unrecorded: 0, present: 0, late: 0, absent: 0, left_early: 0 },
      readiness: {
        checked_at: "2026-10-16T02:30:00.000Z",
        can_schedule: false,
        candidate_count: 25,
        room_capacity: 60,
        accepted_invigilator_count: 1,
        required_invigilator_count: 1,
        timetable_contract: "effective_school_schedule_v4",
        blockers: [
          { code: "class_timetable", message: "Class 10A already has Mathematics (09:00–09:45).", source: "effective_timetable", source_id: "class:occurrence-1" },
          { code: "invigilator_timetable", message: "Meera Kapoor is teaching Class 10A (09:00–09:45).", source: "effective_timetable", source_id: "teacher:teacher-1:occurrence-1" },
        ],
      },
    };

    render(<ExamDayPanel schoolId="school-1" assessmentId="assessment-1" operation={planning} viewerRole="admin" refresh={vi.fn().mockResolvedValue(undefined)}/>);

    expect(screen.getByText("Not ready to schedule")).toBeInTheDocument();
    expect(screen.getByText("Class 10A already has Mathematics (09:00–09:45).")).toBeInTheDocument();
    expect(screen.getByText("Meera Kapoor is teaching Class 10A (09:00–09:45).")).toBeInTheDocument();
    expect(screen.getByText("25 eligible")).toBeInTheDocument();
    expect(screen.getByText("Roster freezes when scheduled")).toBeInTheDocument();
    expect(screen.queryByText("0 of 0")).not.toBeInTheDocument();
    expect(screen.queryByText(/timetable checks are clear/i)).not.toBeInTheDocument();
  });

  it("lets the invited invigilator accept the explicit duty offer", async () => {
    const assignment = { ...operation.invigilators[0]!, status: "offered" as const, revision: 1 };
    const offered: ExamOperation = { ...operation, sitting: { ...operation.sitting, state: "planning" }, invigilators: [assignment], viewer_assignment: assignment, candidates: [], attendance_counts: { total: 0, unrecorded: 0, present: 0, late: 0, absent: 0, left_early: 0 } };
    vi.mocked(respondToInvigilation).mockResolvedValue({ ...assignment, status: "accepted", revision: 2 });
    render(<ExamDayPanel schoolId="school-1" assessmentId="assessment-1" operation={offered} viewerRole="invigilator" refresh={vi.fn().mockResolvedValue(undefined)}/>);

    fireEvent.click(screen.getByRole("button", { name: "Accept duty" }));
    await waitFor(() => expect(respondToInvigilation).toHaveBeenCalledOnce());
    const [school,assessment,assignmentId,request]=vi.mocked(respondToInvigilation).mock.calls[0]!;
    expect([school,assessment,assignmentId]).toEqual(["school-1","assessment-1","assignment-1"]);
    expect(request).toEqual({command_id:request.command_id,expected_revision:1,decision:"accepted",note:""});
    expect(request.command_id).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("requires an inline reason when the invited invigilator declines", async () => {
    const assignment = { ...operation.invigilators[0]!, status: "offered" as const, revision: 1 };
    const offered: ExamOperation = { ...operation, sitting: { ...operation.sitting, state: "planning" }, invigilators: [assignment], viewer_assignment: assignment, candidates: [], attendance_counts: { total: 0, unrecorded: 0, present: 0, late: 0, absent: 0, left_early: 0 } };
    vi.mocked(respondToInvigilation).mockResolvedValue({ ...assignment, status: "declined", response_note: "I am assigned to another class.", revision: 2 });
    const prompt = vi.spyOn(window, "prompt");
    render(<ExamDayPanel schoolId="school-1" assessmentId="assessment-1" operation={offered} viewerRole="invigilator" refresh={vi.fn().mockResolvedValue(undefined)}/>);

    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    const form = screen.getByRole("form", { name: "Decline invigilation duty" });
    fireEvent.change(within(form).getByLabelText("Reason for declining"), { target: { value: "I am assigned to another class." } });
    fireEvent.click(within(form).getByRole("button", { name: "Send decline" }));

    await waitFor(() => expect(respondToInvigilation).toHaveBeenCalledOnce());
    const [school,assessment,assignmentId,request]=vi.mocked(respondToInvigilation).mock.calls[0]!;
    expect([school,assessment,assignmentId]).toEqual(["school-1","assessment-1","assignment-1"]);
    expect(request).toEqual({command_id:request.command_id,expected_revision:1,decision:"declined",note:"I am assigned to another class."});
    expect(request.command_id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(prompt).not.toHaveBeenCalled();
  });

  it("marks only the remaining candidates and saves attendance as one batch", async () => {
    vi.mocked(saveExamAttendance).mockResolvedValue({ sitting_revision: 8, records: [] });
    const refresh = vi.fn().mockResolvedValue(undefined);
    render(<ExamDayPanel schoolId="school-1" assessmentId="assessment-1" operation={operation} viewerRole="admin" refresh={refresh}/>);

    const aarav = screen.getByRole("article", { name: "Aarav Sharma" });
    const zara = screen.getByRole("article", { name: "Zara Sinha" });
    expect(within(aarav).getByRole("button", { name: "Absent" })).toHaveAttribute("aria-pressed", "true");
    expect(within(zara).getByRole("button", { name: "Present" })).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(screen.getByRole("button", { name: /Mark remaining present/ }));
    expect(within(aarav).getByRole("button", { name: "Absent" })).toHaveAttribute("aria-pressed", "true");
    expect(within(zara).getByRole("button", { name: "Present" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Save attendance" }));

    await waitFor(() => expect(saveExamAttendance).toHaveBeenCalledOnce());
    const attendanceCall = vi.mocked(saveExamAttendance).mock.calls[0]!;
    expect(attendanceCall.slice(0, 3)).toEqual(["school-1", "assessment-1", 7]);
    expect(attendanceCall[3]).toHaveLength(1);
    expect(attendanceCall[3][0]).toMatchObject({ student_id: "student-2", status: "present", expected_revision: 1 });
    expect(typeof attendanceCall[3][0]?.observed_at).toBe("string");
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("records an incident through a labelled form without browser prompts", async () => {
    vi.mocked(createExamIncident).mockResolvedValue({ sitting_revision: 8, incident: { id: "incident-1", student_id: "student-2", category: "health", severity: "major", summary: "Candidate felt unwell and the nurse was called.", state: "open", observed_at: "2026-10-16T03:45:00.000Z", revision: 1 } });
    const prompt = vi.spyOn(window, "prompt");
    render(<ExamDayPanel schoolId="school-1" assessmentId="assessment-1" operation={operation} viewerRole="admin" refresh={vi.fn().mockResolvedValue(undefined)}/>);

    expect(screen.queryByRole("form", { name: "Report exam incident" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Report incident" }));
    const form = screen.getByRole("form", { name: "Report exam incident" });
    fireEvent.change(within(form).getByLabelText("Candidate (optional)"), { target: { value: "student-2" } });
    fireEvent.change(within(form).getByLabelText("Category"), { target: { value: "health" } });
    fireEvent.change(within(form).getByLabelText("Severity"), { target: { value: "major" } });
    fireEvent.change(within(form).getByLabelText("Observed at"), { target: { value: "2026-10-16T09:15" } });
    fireEvent.change(within(form).getByLabelText("What happened?"), { target: { value: "Candidate felt unwell and the nurse was called." } });
    fireEvent.click(within(form).getByRole("button", { name: "Record incident" }));

    await waitFor(() => expect(createExamIncident).toHaveBeenCalledOnce());
    const incidentCall = vi.mocked(createExamIncident).mock.calls[0]!;
    expect(incidentCall.slice(0, 2)).toEqual(["school-1", "assessment-1"]);
    expect(incidentCall[2]).toMatchObject({ expected_revision: 7, student_id: "student-2", category: "health", severity: "major", summary: "Candidate felt unwell and the nurse was called." });
    expect(typeof incidentCall[2].observed_at).toBe("string");
    expect(prompt).not.toHaveBeenCalled();
    expect(screen.queryByRole("form", { name: "Report exam incident" })).not.toBeInTheDocument();
  });
});
