import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type {
  AttendanceRegisterHistoryResponse,
  AttendanceStatus,
  TeacherAttendanceResponse,
  TeacherAttendanceSaveInput,
} from "../../features/operations/api";
import { TeacherAttendancePage } from "./TeacherPages";

vi.mock("./OperationsShell", () => ({
  OperationsShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("./PhotoAttendanceDialog", () => ({
  PhotoAttendanceDialog: ({ onApply, onClose }: {
    onApply: (records: Array<{ student_id: string; status: AttendanceStatus; remarks: string }>, sessionId: string) => void;
    onClose: () => void;
  }) => (
    <div role="dialog" aria-label="Photo roll call">
      <button type="button" onClick={() => {
        onApply([
          { student_id: "student-1", status: "present", remarks: "" },
          { student_id: "student-2", status: "late", remarks: "" },
        ], "photo-session-1");
        onClose();
      }}>Apply photo review</button>
    </div>
  ),
}));

afterEach(cleanup);

function attendanceData(
  states: Array<AttendanceStatus | null> = [null, null],
  register: TeacherAttendanceResponse["register"] = {
    state: "draft",
    revision: 0,
    submitted_by: null,
    submitted_at: null,
    locked_by: null,
    locked_at: null,
  },
): TeacherAttendanceResponse {
  const names = ["Aarav Sharma", "Ananya Iyer"];
  return {
    date: "2026-09-12",
    class: { id: "class-7a", school_id: "school-1", term_id: "term-1", name: "Class 7A", grade: "7", section: "A", room: "204", board: "CBSE", term: "Term 1 - 2026-27" },
    periods: [],
    register,
    continuity_snapshot: {
      roster_fingerprint: "a".repeat(64),
      roster_count: states.length,
      captured_at: "2026-09-12T08:00:00.000Z",
      expires_at: "2026-09-13T02:00:00.000Z",
      token: "t".repeat(43),
    },
    latest_capture: null,
    roster: states.map((status, index) => ({
      id: `student-${index + 1}`,
      admission_number: `CIS-2026-0${index + 1}`,
      avatar_url: "",
      roll_number: index + 1,
      name: names[index]!,
      status,
      remarks: "",
      attendance_id: status ? `attendance-${index + 1}` : null,
      updated_at: status ? "2026-09-12T09:00:00.000Z" : null,
    })),
  };
}

function renderRegister(overrides: Partial<React.ComponentProps<typeof TeacherAttendancePage>> = {}) {
  const data = overrides.data ?? attendanceData();
  const onSave = overrides.onSave ?? vi.fn(() => Promise.resolve(attendanceData(["present", "present"], {
    ...data.register,
    state: "submitted",
    revision: data.register.revision + 1,
    submitted_by: "teacher-1",
    submitted_at: "2026-09-12T09:30:00.000Z",
  })));
  const props: React.ComponentProps<typeof TeacherAttendancePage> = {
    data,
    date: "2026-09-12",
    onDateChange: vi.fn(),
    onSave,
    onRefresh: vi.fn(() => Promise.resolve(data)),
    ...overrides,
  };
  return { ...render(<MemoryRouter><TeacherAttendancePage {...props} /></MemoryRouter>), props };
}

describe("teacher attendance register lifecycle", () => {
  it('opens the requested learner from an agent receipt and can return to the whole roster',async()=>{
    const interact=userEvent.setup();renderRegister({initialStudentId:'student-2'});
    expect(screen.getByRole('textbox',{name:'Search student or roll number'})).toHaveValue('CIS-2026-02');
    expect(screen.getByText('Ananya Iyer')).toBeVisible();expect(screen.queryByText('Aarav Sharma')).not.toBeInTheDocument();
    await interact.click(screen.getByRole('button',{name:'Clear search'}));expect(screen.getByText('Aarav Sharma')).toBeVisible();
  });
  it("makes an offline device save unmistakable and prevents a duplicate submission", () => {
    renderRegister({
      data: {
        ...attendanceData(["present", "present"]),
        latest_capture: {
          id: "queued-1",
          source: "offline_device",
          status: "pending",
          received_at: "2026-09-12T09:30:00.000Z",
          roster_expires_at: "2026-09-13T02:00:00.000Z",
        },
      },
    });
    expect(screen.getByText("Saved on this device — not submitted")).toBeVisible();
    expect(screen.getByText(/Sync will retry automatically/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Submit register" })).toBeDisabled();
  });

  it("sends a paper observation to review only after a source reference is recorded", async () => {
    const interact = userEvent.setup();
    const onSave = vi.fn<(input: TeacherAttendanceSaveInput) => Promise<TeacherAttendanceResponse>>(() => Promise.resolve({
      ...attendanceData(["present", "present"]),
      latest_capture: {
        id: "paper-1",
        source: "paper",
        status: "quarantined",
        received_at: "2026-09-12T09:30:00.000Z",
        roster_expires_at: "2026-09-13T02:00:00.000Z",
      },
    }));
    renderRegister({ portal: "principal", initialCaptureSource: "paper", onSave });
    await interact.click(screen.getByRole("button", { name: "Mark all present" }));
    expect(screen.getByRole("button", { name: "Send for review" })).toBeDisabled();
    await interact.type(screen.getByPlaceholderText("Example: Register book 7A, page 42"), "Register book 7A, page 42");
    await interact.click(screen.getByRole("button", { name: "Send for review" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      source: "paper",
      source_reference: "Register book 7A, page 42",
    })));
    expect(await screen.findByText("Observation received and held for attendance-desk review.")).toBeVisible();
  });

  it("starts principal registers in review mode and requires an explicit edit action", async () => {
    const interact = userEvent.setup();
    renderRegister({ portal: "principal" });
    expect(screen.getByText("Principal review")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Submit register" })).not.toBeInTheDocument();
    expect(within(screen.getByRole("article", { name: "Aarav Sharma" })).getByRole("button", { name: "Present" })).toBeDisabled();
    await interact.click(screen.getByRole("button", { name: "Complete register" }));
    expect(screen.getByRole("button", { name: "Submit register" })).toBeDisabled();
    expect(within(screen.getByRole("article", { name: "Aarav Sharma" })).getByRole("button", { name: "Present" })).toBeEnabled();
  });
  it("fills remaining marks without overwriting an existing absence", async () => {
    const interact = userEvent.setup();
    renderRegister({ data: attendanceData(["absent", null]) });
    await interact.click(screen.getByRole("button", { name: "Mark remaining present" }));
    expect(within(screen.getByRole("article", { name: "Aarav Sharma" })).getByRole("button", { name: "Absent" })).toHaveAttribute("aria-pressed", "true");
    expect(within(screen.getByRole("article", { name: "Ananya Iyer" })).getByRole("button", { name: "Present" })).toHaveAttribute("aria-pressed", "true");
  });
  it("explains dates that cannot be marked before a submission attempt", () => {
    renderRegister({ data: { ...attendanceData(), availability: { can_mark: false, reason: "Attendance opens on this date." } } });
    expect(screen.getByText("Attendance opens on this date.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Take from photo" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Submit register" })).not.toBeInTheDocument();
  });
  it("keeps quick marks and notes when filtering, and submits the complete roster", async () => {
    const interact = userEvent.setup();
    const { props } = renderRegister();
    const aarav = screen.getByRole("article", { name: "Aarav Sharma" });
    await interact.click(within(aarav).getByRole("button", { name: "Absent", exact: true }));
    await interact.click(within(aarav).getByRole("button", { name: "Add note for Aarav Sharma" }));
    await interact.type(screen.getByLabelText("Attendance remark for Aarav Sharma"), "Family informed the school");
    await interact.click(screen.getByRole("button", { name: "Hide note for Aarav Sharma" }));
    expect(screen.queryByLabelText("Attendance remark for Aarav Sharma")).not.toBeInTheDocument();

    await interact.click(screen.getByRole("button", { name: "Not marked 1" }));
    expect(screen.queryByRole("article", { name: "Aarav Sharma" })).not.toBeInTheDocument();
    await interact.click(within(screen.getByRole("article", { name: "Ananya Iyer" })).getByRole("button", { name: "Present", exact: true }));
    expect(screen.getByText("Every student has been marked.")).toBeVisible();
    await interact.click(screen.getByRole("button", { name: "Exceptions 1" }));
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(within(screen.getByRole("article", { name: "Aarav Sharma" })).getByRole("button", { name: "Absent", exact: true })).toHaveAttribute("aria-pressed", "true");
    await interact.click(screen.getByRole("button", { name: "View note for Aarav Sharma" }));
    expect(screen.getByLabelText("Attendance remark for Aarav Sharma")).toHaveValue("Family informed the school");
    await interact.click(screen.getByRole("button", { name: "Submit register" }));
    await waitFor(() => expect(props.onSave).toHaveBeenCalledWith(expect.objectContaining({ records: [
      { student_id: "student-1", status: "absent", remarks: "Family informed the school" },
      { student_id: "student-2", status: "present", remarks: "" },
    ] })));
  });

  it("keeps every quick attendance control read-only in a locked register", () => {
    renderRegister({ data: attendanceData(["present", "late"], {
      state: "locked", revision: 3, submitted_at: "2026-09-12T09:00:00.000Z", submitted_by: "teacher-1", locked_at: "2026-09-12T10:00:00.000Z", locked_by: "principal-1",
    }) });
    const row = screen.getByRole("article", { name: "Aarav Sharma" });
    expect(within(row).getByRole("button", { name: "Present", exact: true })).toBeDisabled();
    expect(within(row).getByRole("button", { name: "Absent", exact: true })).toBeDisabled();
    expect(within(row).getByRole("combobox")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Mark all present" })).toBeDisabled();
  });

  it("keeps blank statuses explicit and only submits after every student is marked", async () => {
    const interact = userEvent.setup();
    const onSave = vi.fn<(input: TeacherAttendanceSaveInput) => Promise<TeacherAttendanceResponse>>(() => Promise.resolve(attendanceData(["present", "present"], {
      state: "submitted",
      revision: 1,
      submitted_by: "teacher-1",
      submitted_at: "2026-09-12T09:30:00.000Z",
      locked_by: null,
      locked_at: null,
    })));
    renderRegister({ onSave });

    expect(screen.getByRole("combobox", { name: "Attendance status for Aarav Sharma" })).toHaveValue("");
    expect(screen.getByRole("button", { name: "Submit register" })).toBeDisabled();
    expect(screen.getByText("2", { selector: ".is-incomplete strong" })).toBeVisible();

    await interact.click(screen.getByRole("button", { name: "Mark all present" }));
    expect(screen.getByRole("combobox", { name: "Attendance status for Aarav Sharma" })).toHaveValue("present");
    expect(screen.getByRole("button", { name: "Submit register" })).toBeEnabled();
    await interact.click(screen.getByRole("button", { name: "Submit register" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0]![0]).toMatchObject({
      expected_revision: 0,
      records: [
        { student_id: "student-1", status: "present", remarks: "" },
        { student_id: "student-2", status: "present", remarks: "" },
      ],
    });
    expect(onSave.mock.calls[0]![0].idempotency_key).toMatch(/^[0-9a-f-]{36}$/);
    expect(await screen.findByText("Attendance register submitted.")).toBeVisible();
  });

  it("keeps reviewed photo marks as an unsaved draft and links the analysis on submit", async () => {
    const interact = userEvent.setup();
    const onSave = vi.fn<(input: TeacherAttendanceSaveInput) => Promise<TeacherAttendanceResponse>>(() => Promise.resolve(attendanceData(["present", "late"], {
      state: "submitted",
      revision: 1,
      submitted_by: "teacher-1",
      submitted_at: "2026-09-12T09:30:00.000Z",
      locked_by: null,
      locked_at: null,
    })));
    renderRegister({ onSave });

    await interact.click(screen.getByRole("button", { name: "Take from photo" }));
    expect(screen.getByRole("dialog", { name: "Photo roll call" })).toBeVisible();
    await interact.click(screen.getByRole("button", { name: "Apply photo review" }));

    expect(screen.getByText("Photo review added to this draft")).toBeVisible();
    expect(screen.getByRole("combobox", { name: "Attendance status for Aarav Sharma" })).toHaveValue("present");
    expect(screen.getByRole("combobox", { name: "Attendance status for Ananya Iyer" })).toHaveValue("late");
    await interact.click(screen.getByRole("button", { name: "Submit register" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0]![0]).toMatchObject({
      photo_session_id: "photo-session-1",
      records: [
        { student_id: "student-1", status: "present", remarks: "" },
        { student_id: "student-2", status: "late", remarks: "" },
      ],
    });
  });

  it("reuses one idempotency key when the same failed save is retried", async () => {
    const interact = userEvent.setup();
    const saved = attendanceData(["present", "present"], {
      state: "submitted",
      revision: 1,
      submitted_by: "teacher-1",
      submitted_at: "2026-09-12T09:30:00.000Z",
      locked_by: null,
      locked_at: null,
    });
    const onSave = vi.fn<(input: TeacherAttendanceSaveInput) => Promise<TeacherAttendanceResponse>>()
      .mockRejectedValueOnce(new Error("Temporary network failure"))
      .mockResolvedValueOnce(saved);
    renderRegister({ onSave });

    await interact.click(screen.getByRole("button", { name: "Mark all present" }));
    await interact.click(screen.getByRole("button", { name: "Submit register" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Temporary network failure");
    await interact.click(screen.getByRole("button", { name: "Submit register" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
    expect(onSave.mock.calls[1]![0].idempotency_key).toBe(onSave.mock.calls[0]![0].idempotency_key);
  });

  it("requires an audit reason for a correction and sends the current revision", async () => {
    const interact = userEvent.setup();
    const submitted = attendanceData(["present", "present"], {
      state: "submitted",
      revision: 4,
      submitted_by: "teacher-1",
      submitted_at: "2026-09-12T09:30:00.000Z",
      locked_by: null,
      locked_at: null,
    });
    const corrected = attendanceData(["absent", "present"], { ...submitted.register, revision: 5 });
    const onSave = vi.fn<(input: TeacherAttendanceSaveInput) => Promise<TeacherAttendanceResponse>>(() => Promise.resolve(corrected));
    renderRegister({ data: submitted, onSave, onRefresh: vi.fn(() => Promise.resolve(submitted)) });

    await interact.selectOptions(screen.getByRole("combobox", { name: "Attendance status for Aarav Sharma" }), "absent");
    expect(screen.getByRole("button", { name: "Save correction" })).toBeDisabled();
    await interact.type(screen.getByLabelText("Reason for correction"), "Entry verified with the class teacher");
    await interact.click(screen.getByRole("button", { name: "Save correction" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0]![0]).toMatchObject({
      expected_revision: 4,
      reason: "Entry verified with the class teacher",
    });
  });

  it("merges a newer server revision without discarding local edits", async () => {
    const interact = userEvent.setup();
    const original = attendanceData(["present", "present"], {
      state: "submitted",
      revision: 2,
      submitted_by: "teacher-1",
      submitted_at: "2026-09-12T09:00:00.000Z",
      locked_by: null,
      locked_at: null,
    });
    const latest = attendanceData(["late", "present"], { ...original.register, revision: 3 });
    const onRefresh = vi.fn(() => Promise.resolve(latest));
    const view = renderRegister({ data: original, onRefresh });

    await interact.selectOptions(screen.getByRole("combobox", { name: "Attendance status for Aarav Sharma" }), "absent");
    view.rerender(<MemoryRouter><TeacherAttendancePage {...view.props} data={latest} /></MemoryRouter>);
    const updateNotice = screen.getByText("A newer register is available").closest("section")!;
    await interact.click(within(updateNotice).getByRole("button", { name: "Merge latest" }));

    expect(await screen.findByText("Review 1 concurrent change")).toBeVisible();
    expect(screen.getByRole("combobox", { name: "Attendance status for Aarav Sharma" })).toHaveValue("absent");
    expect(screen.getByText(/Your local choices are still selected/)).toBeVisible();
  });

  it("requires a reason before a principal unlocks a finalized register", async () => {
    const interact = userEvent.setup();
    const locked = attendanceData(["present", "present"], {
      state: "locked",
      revision: 6,
      submitted_by: "teacher-1",
      submitted_at: "2026-09-12T09:00:00.000Z",
      locked_by: "principal-1",
      locked_at: "2026-09-12T10:00:00.000Z",
    });
    const unlocked = attendanceData(["present", "present"], {
      ...locked.register,
      state: "submitted",
      revision: 7,
      locked_by: null,
      locked_at: null,
      reopened_by: "principal-1",
      reopened_at: "2026-09-12T10:15:00.000Z",
    });
    const onUnlock = vi.fn(() => Promise.resolve(unlocked));
    const onLoadHistory = vi.fn(() => Promise.resolve({
      date: locked.date,
      class: locked.class,
      register: locked.register,
      submissions: [{
        id: "submission-6", register_revision: 6, records_count: 2, changed_count: 1,
        created_at: "2026-09-12T09:00:00.000Z", submitted_by_name: "Kavita Mehta",
        capture_source: "live_app" as const, observed_at: null, source_reference: null,
      }],
      revisions: [{
        id: "revision-6",
        student_id: "student-1",
        student_name: "Aarav Sharma",
        previous_status: "late" as const,
        new_status: "present" as const,
        previous_remarks: "Traffic delay",
        new_remarks: "",
        reason: "Gate record verified",
        register_revision: 6,
        created_at: "2026-09-12T09:00:00.000Z",
        changed_by_name: "Kavita Mehta",
      }],
    }));
    renderRegister({
      data: locked,
      portal: "principal",
      onLock: vi.fn(() => Promise.resolve(locked)),
      onUnlock,
      onRefresh: vi.fn(() => Promise.resolve(locked)),
      onLoadHistory,
    });

    await interact.click(screen.getByRole("button", { name: "Change history" }));
    expect(await screen.findByText("1 student record changed")).toBeVisible();
    expect(onLoadHistory).toHaveBeenCalledTimes(1);
    await interact.click(screen.getByRole("button", { name: "Hide history" }));
    await interact.click(screen.getByRole("button", { name: "Unlock register" }));
    const reason = screen.getByLabelText("Reason");
    const confirm = screen.getAllByRole("button", { name: "Unlock register" })[1]!;
    expect(confirm).toBeDisabled();
    await interact.type(reason, "Parent supplied approved medical documentation");
    await interact.click(confirm);

    await waitFor(() => expect(onUnlock).toHaveBeenCalledWith("Parent supplied approved medical documentation"));
    expect(await screen.findByText("Register unlocked for correction.")).toBeVisible();
  });

  it("reloads an open principal audit trail when a live register revision arrives", async () => {
    const interact = userEvent.setup();
    const revisionOne = attendanceData(["present", "present"], {
      state: "submitted",
      revision: 1,
      submitted_by: "teacher-1",
      submitted_at: "2026-09-12T09:00:00.000Z",
      locked_by: null,
      locked_at: null,
    });
    const revisionTwo = attendanceData(["late", "present"], {
      ...revisionOne.register,
      revision: 2,
      submitted_at: "2026-09-12T09:15:00.000Z",
    });
    const historyFor = (data: TeacherAttendanceResponse): AttendanceRegisterHistoryResponse => ({
      date: data.date,
      class: data.class,
      register: data.register,
      submissions: [{
        id: `submission-${data.register.revision}`,
        register_revision: data.register.revision,
        records_count: 2,
        changed_count: data.register.revision,
        created_at: data.register.submitted_at!,
        submitted_by_name: "Kavita Mehta",
        capture_source: "live_app",
        observed_at: null,
        source_reference: null,
      }],
      revisions: [],
    });
    const onLoadHistory = vi.fn<() => Promise<AttendanceRegisterHistoryResponse>>()
      .mockResolvedValueOnce(historyFor(revisionOne))
      .mockResolvedValueOnce(historyFor(revisionTwo));
    const view = renderRegister({
      data: revisionOne,
      portal: "principal",
      onLock: vi.fn(() => Promise.resolve(revisionOne)),
      onUnlock: vi.fn(() => Promise.resolve(revisionOne)),
      onLoadHistory,
    });

    await interact.click(screen.getByRole("button", { name: "Change history" }));
    await waitFor(() => expect(onLoadHistory).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("R1")).toBeVisible();

    view.rerender(<MemoryRouter><TeacherAttendancePage {...view.props} data={revisionTwo} /></MemoryRouter>);

    await waitFor(() => expect(onLoadHistory).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("R2")).toBeVisible();
  });
});
