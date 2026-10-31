import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Navigate,useLocation,useNavigate,useSearchParams } from "react-router-dom";
import { useProFeatures } from '../auth/useProFeatures';
import { useOptionalAuth } from "../auth/AuthContext";
import { schoolDateToday, shiftSchoolDate } from "../../lib/schoolTime";
import { timetableSummaryRange, readTimetableView } from "../timetable/TimetableNavigator";
import { resolveTimetableDisplayDate, type TimetableRehearsalIndicator } from "../planner/rehearsal";
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
  getStudentTimetableSummary,
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

function StudentAttendanceExperience({ openCopilot = false, embedded = false }: { openCopilot?: boolean; embedded?: boolean }) {
  const navigate = useNavigate();
  const [workspaceParams, setWorkspaceParams] = useSearchParams();
  const pro=useProFeatures();
  const query = useQuery({
    queryKey: ["school", "student", "attendance"],
    queryFn: getStudentAttendance,
  });
  if (query.isPending) return <ScreenLoading />;
  if (query.isError || !query.data) return <LiveRouteError error={query.error} onRetry={query.refetch} />;
  return (
    <StudentAttendancePage
      data={adaptStudentAttendance(query.data)}
      embedded={embedded}
      proFeaturesEnabled={pro.enabled}
      onAskCopilot={(question) => askAttendanceCopilot({ question })}
      initialCopilotOpen={openCopilot}
      onCopilotClose={openCopilot ? () => {
        if (!embedded) {
          void navigate("/student/attendance", { replace: true });
          return;
        }
        const next = new URLSearchParams(workspaceParams);
        next.delete("view");
        setWorkspaceParams(next, { replace: true });
      } : undefined}
      activeNav={openCopilot ? "copilot" : "attendance"}
      onApplyMedicalExcuse={() => {
        if (!embedded) {
          void navigate("/student/leave/new");
          return;
        }
        const next = new URLSearchParams(workspaceParams);
        next.set("view", "apply");
        void navigate(`/areas/attendance/leave?${next}`);
      }}
      onViewEligibility={() => {
        if (!embedded) {
          void navigate("/student/attendance/eligibility");
          return;
        }
        const next = new URLSearchParams(workspaceParams);
        next.set("view", "eligibility");
        void navigate(`/areas/attendance/records?${next}`);
      }}
    />
  );
}

function StudentAttendanceLegacyRedirect({ view }: { readonly view?: "copilot" | "eligibility" }) {
  const location = useLocation();
  const next = new URLSearchParams(location.search);
  next.set("scope", "self");
  if (view) next.set("view", view);
  return <Navigate replace to={{
    pathname: "/areas/attendance/records",
    search: next.toString(),
    hash: location.hash,
  }} />;
}

export function StudentHomeRoute() {
  const pro=useProFeatures();
  const auth = useOptionalAuth();
  const query = useQuery({
    queryKey: ["school", "student", "home"],
    queryFn: getStudentHome,
  });
  if (query.isPending) return <ScreenLoading />;
  if (query.isError || !query.data) return <LiveRouteError error={query.error} onRetry={query.refetch} />;
  const schoolName = auth?.memberships.find((membership) => membership.role === "student")?.school_name;
  return <StudentHomePage data={adaptStudentHome(query.data)} schoolName={schoolName} proFeaturesEnabled={pro.enabled} />;
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

export function StudentAttendanceRoute({ embedded = false, openCopilot = false }: { readonly embedded?: boolean; readonly openCopilot?: boolean } = {}) {
  return <StudentAttendanceExperience embedded={embedded} openCopilot={openCopilot} />;
}

export function StudentCopilotRoute() {
  return <StudentAttendanceLegacyRedirect view="copilot" />;
}

function StudentEligibilityExperience({ embedded }: { readonly embedded: boolean }) {
  const navigate = useNavigate();
  const [workspaceParams] = useSearchParams();
  const pro=useProFeatures();
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
      proFeaturesEnabled={pro.enabled}
      embedded={embedded}
      onAskCopilot={(question) => askAttendanceCopilot({ question })}
      onViewTimetable={() => {
        if (!embedded) {
          void navigate("/student/timetable");
          return;
        }
        const next = new URLSearchParams(workspaceParams);
        next.delete("view");
        void navigate(`/areas/timetable/schedule?${next}`);
      }}
      onSubmitDocument={submitDocument}
    />
  );
}

export function StudentEligibilityRoute({ embedded = false }: { readonly embedded?: boolean } = {}) {
  return embedded
    ? <StudentEligibilityExperience embedded />
    : <StudentAttendanceLegacyRedirect view="eligibility" />;
}

export function StudentLeaveNewRoute({ embedded = false }: { readonly embedded?: boolean } = {}) {
  const navigate = useNavigate();
  const [workspaceParams] = useSearchParams();
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
  const statusParams = new URLSearchParams(workspaceParams);
  statusParams.delete("view");
  return (
    <StudentLeaveNewPage
      embedded={embedded}
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
      onOpenStatus={embedded ? () => navigate(`/areas/attendance/leave?${statusParams}`) : undefined}
    />
  );
}

export function StudentLeaveStatusRoute({ embedded = false }: { readonly embedded?: boolean } = {}) {
  const navigate = useNavigate();
  const [workspaceParams] = useSearchParams();
  const refresh = useRefreshSchoolData();
  const query = useQuery({
    queryKey: ["school", "student", "leave", "status"],
    queryFn: getStudentLeaveStatus,
  });
  if (query.isPending) return <ScreenLoading />;
  if (query.isError || !query.data) return <LiveRouteError error={query.error} onRetry={query.refetch} />;
  const response = query.data;
  const applyParams = new URLSearchParams(workspaceParams);
  applyParams.set("view", "apply");
  const eligibilityParams = new URLSearchParams(workspaceParams);
  eligibilityParams.set("view", "eligibility");
  return (
    <StudentLeaveStatusPage
      data={adaptStudentLeaveStatus(response)}
      embedded={embedded}
      onApplyLeave={embedded ? () => navigate(`/areas/attendance/leave?${applyParams}`) : undefined}
      onViewEligibility={embedded ? () => navigate(`/areas/attendance/records?${eligibilityParams}`) : undefined}
      onViewPrescription={(documentUrl) => window.open(documentUrl, "_blank", "noopener,noreferrer")}
      onWithdraw={async (requestId) => {
        await performLeaveAction(requestId, "withdraw", "Withdrawn by student.");
        await refresh();
      }}
    />
  );
}

export function StudentTimetableRoute({ rehearsal }: { rehearsal?: TimetableRehearsalIndicator | null } = {}) {
  const [params,setParams]=useSearchParams();
  const date=resolveTimetableDisplayDate(params.get('date'),rehearsal,schoolDateToday());
  const view = readTimetableView(params.get("view"));
  const anchor=date;
  const range=timetableSummaryRange(anchor,view);
  const query = useQuery({
    queryKey: ["school", "student", "timetable",date],
    queryFn: () => getStudentTimetable(date),
    placeholderData: (previous) => previous,
  });
  const summary=useQuery({
    queryKey:["school","student","timetable-summary",range.start,range.end,anchor],
    queryFn:()=>getStudentTimetableSummary(range.start,range.end,anchor),
  });
  if (query.isPending) return <ScreenLoading />;
  if (query.isError || !query.data) return <LiveRouteError error={query.error} onRetry={query.refetch} />;
  return (
    <StudentTimetablePage
      rehearsal={rehearsal}
      dayPlan={query.data.day_plan} selectedDate={anchor} scheduleLoading={query.isPlaceholderData} onDateChange={date=>{const next=new URLSearchParams(params);next.set('date',date);setParams(next,{replace:true});}}
      view={view} onViewChange={nextView=>{const next=new URLSearchParams(params);next.set("view",nextView);setParams(next,{replace:true});}}
      onNavigate={(nextDate,nextView)=>{const next=new URLSearchParams(params);next.set("date",nextDate);next.set("view",nextView);setParams(next,{replace:true});}}
      summary={summary.data} summaryLoading={summary.isPending} summaryError={summary.isError?summary.error.message:undefined} onSummaryRetry={()=>void summary.refetch()}
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
