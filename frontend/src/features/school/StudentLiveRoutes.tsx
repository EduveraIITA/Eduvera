import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useNavigate,useSearchParams } from "react-router-dom";
import { shiftSchoolDate } from "../../lib/schoolTime";
import { askAttendanceCopilot } from "../attendance/api";
import { StudentAttendancePage } from "../../pages/student/StudentAttendancePage";
import { StudentHomePage } from "../../pages/student/StudentHomePage";
import { StudentDiaryPage } from "../../pages/student/StudentDiaryPage";
import { StudentEligibilityPage, type AbsenceDocumentPayload } from "../../pages/student/StudentEligibilityPage";
import { StudentLeaveNewPage, type StudentLeaveDraft } from "../../pages/student/StudentLeaveNewPage";
import { StudentLeaveStatusPage } from "../../pages/student/StudentLeaveStatusPage";
import { StudentTimetablePage } from "../../pages/student/StudentTimetablePage";
import { StudentWeekGridPage } from "../../pages/student/StudentWeekGridPage";
import {
  createLeave,
  acknowledgeDiary,
  addDiaryNote,
  getStudentAttendance,
  getStudentDiary,
  getStudentHome,
  getStudentEligibility,
  getStudentLeaveApply,
  getStudentLeaveStatus,
  getStudentTimetable,
  performLeaveAction,
} from "./api";
import {
  adaptStudentAttendance,
  adaptStudentDiary,
  adaptStudentHome,
  adaptStudentEligibility,
  adaptStudentLeaveStatus,
  adaptTimetable,
  adaptWeekGrid,
} from "./adapters";
import { LiveRouteError, ScreenLoading } from "./LiveRouteState";

function useRefreshSchoolData() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ["school"] });
}

function StudentAttendanceExperience({ openCopilot = false }: { openCopilot?: boolean }) {
  const navigate = useNavigate();
  const query = useQuery({
    queryKey: ["school", "student", "attendance"],
    queryFn: getStudentAttendance,
  });
  if (query.isPending) return <ScreenLoading />;
  if (query.isError || !query.data) return <LiveRouteError error={query.error} onRetry={query.refetch} />;
  return (
    <StudentAttendancePage
      data={adaptStudentAttendance(query.data)}
      onAskCopilot={(question) => askAttendanceCopilot({ question })}
      initialCopilotOpen={openCopilot}
      onCopilotClose={openCopilot ? () => navigate("/student/attendance", { replace: true }) : undefined}
      activeNav={openCopilot ? "copilot" : "attendance"}
      onApplyMedicalExcuse={() => navigate("/student/leave/new")}
    />
  );
}

export function StudentHomeRoute() {
  const query = useQuery({
    queryKey: ["school", "student", "home"],
    queryFn: getStudentHome,
  });
  if (query.isPending) return <ScreenLoading />;
  if (query.isError || !query.data) return <LiveRouteError error={query.error} onRetry={query.refetch} />;
  return <StudentHomePage data={adaptStudentHome(query.data)} />;
}

export function StudentDiaryRoute() {
  const refresh = useRefreshSchoolData();
  const dateFrom = useMemo(() => shiftSchoolDate(-7), []);
  const dateTo = useMemo(() => shiftSchoolDate(7), []);
  const query = useQuery({
    queryKey: ["school", "student", "diary", dateFrom, dateTo],
    queryFn: () => getStudentDiary(dateFrom, dateTo),
  });
  if (query.isPending) return <ScreenLoading />;
  if (query.isError || !query.data) return <LiveRouteError error={query.error} onRetry={query.refetch} />;
  const response = query.data;
  return (
    <StudentDiaryPage
      data={adaptStudentDiary(response)}
      onAcknowledge={async (itemId) => {
        await acknowledgeDiary(itemId, response.student.id);
        await refresh();
      }}
      onAddNote={async (itemId, body) => {
        await addDiaryNote(itemId, response.student.id, body);
        await refresh();
      }}
    />
  );
}

export function StudentAttendanceRoute() {
  return <StudentAttendanceExperience />;
}

export function StudentCopilotRoute() {
  return <StudentAttendanceExperience openCopilot />;
}

export function StudentEligibilityRoute() {
  const navigate = useNavigate();
  const refresh = useRefreshSchoolData();
  const query = useQuery({
    queryKey: ["school", "student", "eligibility"],
    queryFn: getStudentEligibility,
  });
  if (query.isPending) return <ScreenLoading />;
  if (query.isError || !query.data) return <LiveRouteError error={query.error} onRetry={query.refetch} />;
  const submitDocument = async ({ startDate, endDate, file }: AbsenceDocumentPayload) => {
    await createLeave({
      category: "medical",
      starts_on: startDate,
      ends_on: endDate,
      reason: "Medical absence submitted with a supporting certificate.",
      file,
    });
    await refresh();
  };
  return (
    <StudentEligibilityPage
      data={adaptStudentEligibility(query.data)}
      onAskCopilot={(question) => askAttendanceCopilot({ question })}
      onViewTimetable={() => navigate("/student/timetable")}
      onSubmitDocument={submitDocument}
    />
  );
}

export function StudentLeaveNewRoute() {
  const refresh = useRefreshSchoolData();
  const query = useQuery({
    queryKey: ["school", "student", "leave", "apply"],
    queryFn: getStudentLeaveApply,
  });
  if (query.isPending) return <ScreenLoading />;
  if (query.isError || !query.data) return <LiveRouteError error={query.error} onRetry={query.refetch} />;
  const response = query.data;
  const primaryGuardian = response.guardians.find((guardian) => guardian.is_primary) ?? response.guardians[0];
  const submit = async (draft: StudentLeaveDraft) => {
    await createLeave({
      category: draft.category === "urgent" ? "personal" : draft.category,
      starts_on: draft.startDate,
      ends_on: draft.endDate,
      reason: draft.reason,
      file: draft.attachment,
    });
    await refresh();
  };
  const saveDraft = (draft: StudentLeaveDraft) => {
    window.localStorage.setItem(
      "omnischool.student.leave-draft",
      JSON.stringify({
        category: draft.category,
        startDate: draft.startDate,
        endDate: draft.endDate,
        reason: draft.reason,
        attachmentName: draft.attachment?.name ?? null,
      }),
    );
  };
  return (
    <StudentLeaveNewPage
      context={{
        studentName: response.student.user.display_name,
        className: response.student.current_enrollment.class_name,
        termLabel: `${response.student.current_enrollment.term.name} - ${response.student.current_enrollment.term.academic_year}`,
        categories: response.categories.map((category) => ({
          value: category.value === "personal" ? "urgent" : category.value as StudentLeaveDraft["category"],
          label: category.label,
        })),
        guardian: primaryGuardian ? {
          name: primaryGuardian.guardian.name,
          relationship: primaryGuardian.relationship,
        } : undefined,
        maxDurationDays: response.constraints.max_duration_days,
        medicalDocumentAfterDays: response.constraints.medical_document_after_days,
        acceptedDocumentTypes: response.constraints.accepted_documents,
        maxDocumentSizeBytes: response.constraints.max_document_size_bytes,
      }}
      onSubmit={submit}
      onSaveDraft={saveDraft}
    />
  );
}

export function StudentLeaveStatusRoute() {
  const refresh = useRefreshSchoolData();
  const query = useQuery({
    queryKey: ["school", "student", "leave", "status"],
    queryFn: getStudentLeaveStatus,
  });
  if (query.isPending) return <ScreenLoading />;
  if (query.isError || !query.data) return <LiveRouteError error={query.error} onRetry={query.refetch} />;
  const response = query.data;
  return (
    <StudentLeaveStatusPage
      data={adaptStudentLeaveStatus(response)}
      onViewPrescription={(documentUrl) => window.open(documentUrl, "_blank", "noopener,noreferrer")}
      onWithdraw={async (requestId) => {
        await performLeaveAction(requestId, "withdraw", "Withdrawn by student.");
        await refresh();
      }}
    />
  );
}

export function StudentTimetableRoute() {
  const [params,setParams]=useSearchParams();const date=params.get('date')||undefined;
  const query = useQuery({
    queryKey: ["school", "student", "timetable",date],
    queryFn: () => getStudentTimetable(date),
  });
  if (query.isPending) return <ScreenLoading />;
  if (query.isError || !query.data) return <LiveRouteError error={query.error} onRetry={query.refetch} />;
  return (
    <StudentTimetablePage
      dayPlan={query.data.day_plan} selectedDate={query.data.selected_date} onDateChange={date=>{const next=new URLSearchParams(params);next.set('date',date);setParams(next);}}
      className={query.data.class_name}
      studentName={query.data.student.user.display_name}
      termLabel={`${query.data.student.current_enrollment.term.name} - ${query.data.student.current_enrollment.term.academic_year}`}
      days={adaptTimetable(query.data)}
    />
  );
}

export function StudentWeekGridRoute() {
  const [weekOffset, setWeekOffset] = useState(0);
  const selectedDate = useMemo(() => {
    return shiftSchoolDate(weekOffset * 7);
  }, [weekOffset]);
  const query = useQuery({
    queryKey: ["school", "student", "timetable", selectedDate],
    queryFn: () => getStudentTimetable(selectedDate),
  });
  if (query.isPending) return <ScreenLoading />;
  if (query.isError || !query.data) return <LiveRouteError error={query.error} onRetry={query.refetch} />;
  return (
    <StudentWeekGridPage
      rows={adaptWeekGrid(query.data)}
      className={query.data.class_name}
      weekOffset={weekOffset}
      selectedDate={selectedDate}
      onWeekChange={setWeekOffset}
    />
  );
}
