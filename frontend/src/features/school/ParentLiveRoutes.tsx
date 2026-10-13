import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { schoolDateToday } from "../../lib/schoolTime";
import { timetableSummaryRange, readTimetableView } from "../timetable/TimetableNavigator";
import { ParentAttendancePage } from "../../pages/parent/ParentAttendancePage";
import { ParentDiaryPage } from "../../pages/parent/ParentDiaryPage";
import { ParentHomePage } from "../../pages/parent/ParentHomePage";
import { ParentLeavePage, type ParentLeaveDraft } from "../../pages/parent/ParentLeavePage";
import { StudentTimetablePage } from "../../pages/student/StudentTimetablePage";
import {
  acknowledgeDiary,
  addDiaryNote,
  createLeave,
  getParentAttendance,
  getParentDiary,
  getParentHome,
  getParentLeave,
  getParentLeaveAuthority,
  getParentTimetable,
  getParentTimetableSummary,
  performLeaveAction,
  setHomeworkCompleted,
  type StudentTimetableResponse,
} from "./api";
import {
  adaptParentAttendance,
  adaptParentDiary,
  adaptParentHome,
  adaptParentLeave,
  adaptStudentSummary,
  adaptTimetable,
} from "./adapters";
import { LiveRouteError, ScreenLoading } from "./LiveRouteState";
import { AttentionOpenAcknowledgement } from "../attention/AttentionOpenAcknowledgement";
import { AttentionTargetUnavailable } from "../attention/AttentionTargetUnavailable";

function useRefreshSchoolData() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ["school"] });
}

function useSelectedStudent() {
  const [searchParams, setSearchParams] = useSearchParams();
  const studentId = searchParams.get("student_id") ?? undefined;
  const selectStudent = (nextStudentId: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("student_id", nextStudentId);
    next.delete("leave_id");
    next.delete("diary_item");
    setSearchParams(next);
  };
  return { searchParams, studentId, selectStudent };
}

export function readParentDiaryAttentionTarget(params: URLSearchParams): { date?: string; itemId?: string } {
  return {
    date: params.get("date") ?? undefined,
    itemId: params.get("diary_item") ?? undefined,
  };
}

export function resolveParentTimetableAttention(
  params: URLSearchParams,
  response: StudentTimetableResponse,
): "none" | "exact" | "stale" {
  if (!params.get("attention_notification_id")) return "none";
  const studentId = params.get("student_id");
  const date = params.get("date");
  const dayPlanId = params.get("day_plan_id");
  const scheduleId = params.get("schedule_id");
  const dayPlanRevision = Number(params.get("day_plan_revision"));
  const scheduleRevision = Number(params.get("schedule_revision"));
  const commonScopeMatches = Boolean(
    studentId
    && studentId === response.student.id
    && date
    && date === response.selected_date,
  );
  const exactDayPlan = Boolean(
    commonScopeMatches
    && dayPlanId && !scheduleId
    && Number.isInteger(dayPlanRevision) && dayPlanRevision > 0
    && response.day_plan?.id === dayPlanId
    && response.day_plan.date === date
    && response.day_plan.version === dayPlanRevision,
  );
  const exactSchedule = Boolean(
    commonScopeMatches
    && scheduleId && !dayPlanId
    && Number.isInteger(scheduleRevision) && scheduleRevision > 0
    && response.schedule_source?.id === scheduleId
    && response.schedule_source.revision === scheduleRevision,
  );
  return exactDayPlan || exactSchedule ? "exact" : "stale";
}

function contactAction(contact?: { name: string; email?: string | null; phone?: string | null }) {
  const email = contact?.email?.trim();
  const phone = contact?.phone?.trim();
  if (!email && !phone) return undefined;
  return () => {
    if (email) {
      window.location.assign(`mailto:${email}?subject=${encodeURIComponent(`Message for ${contact?.name ?? "homeroom teacher"}`)}`);
      return;
    }
    window.location.assign(`tel:${phone}`);
  };
}

export function ParentHomeRoute() {
  const { studentId, selectStudent } = useSelectedStudent();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["school", "parent", "home", studentId ?? "default"],
    queryFn: () => getParentHome(studentId),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
  if (query.isPending) return <ScreenLoading />;
  if (query.isError || !query.data) return <LiveRouteError error={query.error} onRetry={query.refetch} />;
  const response = query.data;
  const data = adaptParentHome(response);
  const teacher = response.contacts.find((contact) => /teacher|advisor|homeroom/i.test(contact.label));
  return (
    <ParentHomePage
      data={data}
      onSelectChild={selectStudent}
      onPrepareChild={(childId) => queryClient.fetchQuery({
        queryKey: ["school", "parent", "home", childId],
        queryFn: () => getParentHome(childId),
        staleTime: 30_000,
      }).then(adaptParentHome)}
      onContactTeacher={contactAction(teacher)}
      onToggleHomework={async (itemId, completed) => {
        await setHomeworkCompleted(itemId, data.child.id, completed);
        await queryClient.invalidateQueries({ queryKey: ["school", "parent", "home", studentId ?? "default"] });
      }}
    />
  );
}

export function ParentAttendanceRoute() {
  const { searchParams, studentId, selectStudent } = useSelectedStudent();
  const navigate = useNavigate();
  const focusDate = searchParams.get("date") ?? undefined;
  const focusRecordId = searchParams.get("attendance_record_id");
  const focusRevision = Number(searchParams.get("attendance_revision"));
  const query = useQuery({
    queryKey: ["school", "parent", "attendance", studentId ?? "default"],
    queryFn: () => getParentAttendance(studentId),
  });
  if (query.isPending) return <ScreenLoading />;
  if (query.isError || !query.data) return <LiveRouteError error={query.error} onRetry={query.refetch} />;
  const teacher = query.data.contacts?.find((contact) => /teacher|advisor|homeroom/i.test(contact.label));
  const exactRecord = focusRecordId
    ? query.data.calendar.find((record) => record.id === focusRecordId
      && record.date === focusDate && record.revision === focusRevision)
    : undefined;
  const staleAttentionRecord=Boolean(searchParams.get("attention_notification_id")&&focusRecordId&&!exactRecord);
  return (
    <>
    {exactRecord ? <AttentionOpenAcknowledgement /> : null}
    {staleAttentionRecord ? <AttentionTargetUnavailable message="This attendance update no longer matches the current record. It was not marked as opened."/> : null}
    <ParentAttendancePage
      key={query.data.student.id}
      data={adaptParentAttendance(query.data, focusDate)}
      {...(exactRecord ? { focusDate: exactRecord.date } : {})}
      onSelectChild={selectStudent}
      onRequestLeave={() => navigate(studentId ? `/parent/leave?tab=apply&student_id=${encodeURIComponent(studentId)}` : "/parent/leave?tab=apply")}
      onMessageTeacher={contactAction(teacher)}
    />
    </>
  );
}

export function ParentLeaveRoute() {
  const { searchParams, studentId, selectStudent } = useSelectedStudent();
  const leaveId = searchParams.get("leave_id") ?? undefined;
  const authorityChangeId = searchParams.get("authority_change_id");
  const authorityRevision = Number(searchParams.get("authority_revision"));
  const refresh = useRefreshSchoolData();
  const query = useQuery({
    queryKey: ["school", "parent", "leave", studentId ?? "default", leaveId ?? "pending"],
    queryFn: () => getParentLeave(leaveId, studentId),
  });
  const authority = useQuery({
    queryKey: ["school", "parent", "leave-authority", studentId ?? "default"],
    queryFn: () => getParentLeaveAuthority(studentId),
    enabled: Boolean(authorityChangeId),
  });
  if (query.isPending) return <ScreenLoading />;
  if (query.isError || !query.data) return <LiveRouteError error={query.error} onRetry={query.refetch} />;
  const response = query.data;
  const openedTarget = !leaveId || response.request?.id === leaveId || response.history.some((item) => item.id === leaveId);
  const exactAuthority = authorityChangeId && authority.data?.latest_change_id === authorityChangeId
    && authority.data.revision === authorityRevision ? authority.data : undefined;
  const staleAuthority=Boolean(searchParams.get("attention_notification_id")&&authorityChangeId&&!authority.isPending&&!exactAuthority);
  const createFromParent = async (draft: ParentLeaveDraft) => {
    await createLeave({
      category: draft.category === "other" ? "personal" : draft.category,
      starts_on: draft.fromDate,
      ends_on: draft.toDate,
      reason: draft.reason,
      file: draft.attachment,
      student_id: studentId,
    });
    await refresh();
  };
  return (
    <>
    {authorityChangeId ? exactAuthority ? <AttentionOpenAcknowledgement /> : null : openedTarget ? <AttentionOpenAcknowledgement /> : null}
    {staleAuthority?<AttentionTargetUnavailable message="This signing-access update no longer matches the current authority record. It was not marked as opened."/>:null}
    <ParentLeavePage
      key={`${response.student.id}-${response.request?.id ?? "empty"}`}
      data={adaptParentLeave(response)}
      focusRequestId={leaveId}
      {...(exactAuthority ? { authorityUpdate: { enabled: exactAuthority.enabled, effective: exactAuthority.effective, validFrom: exactAuthority.valid_from, validUntil: exactAuthority.valid_until } } : {})}
      onSelectChild={selectStudent}
      onAuthorize={async (requestId, note) => {
        await performLeaveAction(requestId, "authorize", note);
        await refresh();
      }}
      onRequestClarification={async (requestId, note) => {
        await performLeaveAction(requestId, "clarify", note);
        await refresh();
      }}
      onOpenDocument={(documentId) => {
        const document = response.request?.documents.find((item) => item.id === documentId);
        if (document?.file_url) window.open(document.file_url, "_blank", "noopener,noreferrer");
      }}
      onCreateLeave={createFromParent}
      leaveConstraints={response.constraints ? {
        maxDurationDays: response.constraints.max_duration_days,
        medicalDocumentAfterDays: response.constraints.medical_document_after_days,
        acceptedDocumentTypes: response.constraints.accepted_documents,
        maxDocumentSizeBytes: response.constraints.max_document_size_bytes,
      } : undefined}
    />
    </>
  );
}

export function ParentDiaryRoute() {
  const [params] = useSearchParams();
  const { studentId, selectStudent } = useSelectedStudent();
  const attentionTarget = readParentDiaryAttentionTarget(params);
  const [selectedDate, setSelectedDate] = useState<string | undefined>(() => attentionTarget.date);
  const refresh = useRefreshSchoolData();
  const query = useQuery({
    queryKey: ["school", "parent", "diary", studentId ?? "default", selectedDate ?? "today"],
    queryFn: () => getParentDiary(selectedDate, studentId),
  });
  if (query.isPending) return <ScreenLoading />;
  if (query.isError || !query.data) return <LiveRouteError error={query.error} onRetry={query.refetch} />;
  const response = query.data;
  const acknowledgementTargets = response.items.filter(
    (item) => item.requires_acknowledgement && !item.acknowledged,
  );
  const noteTarget = response.items.find((item) => item.item_type === "announcement" || !item.subject) ?? response.items[0];
  return (
    <ParentDiaryPage
      key={`${response.student.id}-${response.date}`}
      data={adaptParentDiary(response)}
      focusEntryId={attentionTarget.itemId}
      onSelectChild={selectStudent}
      onSelectDay={(dayId) => setSelectedDate(dayId)}
      onAcknowledge={async () => {
        if (acknowledgementTargets.length === 0) throw new Error("No diary acknowledgement is pending.");
        await Promise.all(
          acknowledgementTargets.map((item) => acknowledgeDiary(item.id, response.student.id)),
        );
        await refresh();
      }}
      onSendNote={noteTarget ? async (body) => {
        await addDiaryNote(noteTarget.id, response.student.id, body);
        await refresh();
      } : undefined}
    />
  );
}

export function ParentTimetableRoute() {
  const [params,setParams]=useSearchParams();
  const date=params.get('date')||undefined;
  const view = readTimetableView(params.get("view"));
  const anchor=date??schoolDateToday();
  const range=timetableSummaryRange(anchor,view);
  const { studentId, selectStudent } = useSelectedStudent();
  const query = useQuery({
    queryKey: ["school", "parent", "timetable", studentId ?? "default",date],
    queryFn: () => getParentTimetable(date, studentId),
    // Preserve the calendar during date changes, never a different child's records.
    placeholderData: (previous, previousQuery) => previousQuery?.queryKey[3] === (studentId ?? "default") ? previous : undefined,
  });
  const summary=useQuery({
    queryKey:["school","parent","timetable-summary",studentId??"default",range.start,range.end,anchor],
    queryFn:()=>getParentTimetableSummary(range.start,range.end,anchor,studentId),
  });
  if (query.isPending) return <ScreenLoading />;
  if (query.isError || !query.data) return <LiveRouteError error={query.error} onRetry={query.refetch} />;
  const attentionResolution = query.isPlaceholderData
    ? "none"
    : resolveParentTimetableAttention(params, query.data);
  return (
    <>
    {attentionResolution === "exact" ? <AttentionOpenAcknowledgement /> : null}
    <StudentTimetablePage
      audience="parent"
      focusPublishedSource={attentionResolution === "exact"}
      attentionStatus={attentionResolution === "stale" ? <AttentionTargetUnavailable message="This timetable update no longer matches the published source, revision, child and date. It was not marked as opened." /> : undefined}
      dayPlan={query.data.day_plan} selectedDate={anchor} scheduleLoading={query.isPlaceholderData} onDateChange={date=>{const next=new URLSearchParams(params);next.set('date',date);setParams(next);}}
      view={view} onViewChange={nextView=>{const next=new URLSearchParams(params);next.set("view",nextView);setParams(next);}}
      onNavigate={(nextDate,nextView)=>{const next=new URLSearchParams(params);next.set("date",nextDate);next.set("view",nextView);setParams(next);}}
      summary={summary.data} summaryLoading={summary.isPending} summaryError={summary.isError?summary.error.message:undefined} onSummaryRetry={()=>void summary.refetch()}
      child={adaptStudentSummary(query.data.student)}
      onSelectChild={selectStudent}
      className={query.data.class_name}
      studentName={query.data.student.user.display_name}
      termLabel={`${query.data.student.current_enrollment.term.name} - ${query.data.student.current_enrollment.term.academic_year}`}
      days={adaptTimetable(query.data)}
    />
    </>
  );
}
