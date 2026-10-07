import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { schoolDateToday } from "../../lib/schoolTime";
import { timetableSummaryRange, type TimetableView } from "../timetable/TimetableNavigator";
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
  getParentTimetable,
  getParentTimetableSummary,
  performLeaveAction,
  setHomeworkCompleted,
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
    setSearchParams(next);
  };
  return { searchParams, studentId, selectStudent };
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
  const { studentId, selectStudent } = useSelectedStudent();
  const navigate = useNavigate();
  const query = useQuery({
    queryKey: ["school", "parent", "attendance", studentId ?? "default"],
    queryFn: () => getParentAttendance(studentId),
  });
  if (query.isPending) return <ScreenLoading />;
  if (query.isError || !query.data) return <LiveRouteError error={query.error} onRetry={query.refetch} />;
  const teacher = query.data.contacts?.find((contact) => /teacher|advisor|homeroom/i.test(contact.label));
  return (
    <ParentAttendancePage
      key={query.data.student.id}
      data={adaptParentAttendance(query.data)}
      onSelectChild={selectStudent}
      onRequestLeave={() => navigate(studentId ? `/parent/leave?tab=apply&student_id=${encodeURIComponent(studentId)}` : "/parent/leave?tab=apply")}
      onMessageTeacher={contactAction(teacher)}
    />
  );
}

export function ParentLeaveRoute() {
  const { searchParams, studentId, selectStudent } = useSelectedStudent();
  const leaveId = searchParams.get("leave_id") ?? undefined;
  const refresh = useRefreshSchoolData();
  const query = useQuery({
    queryKey: ["school", "parent", "leave", studentId ?? "default", leaveId ?? "pending"],
    queryFn: () => getParentLeave(leaveId, studentId),
  });
  if (query.isPending) return <ScreenLoading />;
  if (query.isError || !query.data) return <LiveRouteError error={query.error} onRetry={query.refetch} />;
  const response = query.data;
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
    <ParentLeavePage
      key={`${response.student.id}-${response.request?.id ?? "empty"}`}
      data={adaptParentLeave(response)}
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
  );
}

export function ParentDiaryRoute() {
  const { studentId, selectStudent } = useSelectedStudent();
  const [selectedDate, setSelectedDate] = useState<string>();
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
  const requestedView=params.get("view");
  const view: TimetableView=["day","week","month","year"].includes(requestedView??"")?requestedView as TimetableView:"day";
  const anchor=date??schoolDateToday();
  const range=timetableSummaryRange(anchor,view);
  const { studentId, selectStudent } = useSelectedStudent();
  const query = useQuery({
    queryKey: ["school", "parent", "timetable", studentId ?? "default",date],
    queryFn: () => getParentTimetable(date, studentId),
  });
  const summary=useQuery({
    queryKey:["school","parent","timetable-summary",studentId??"default",range.start,range.end,anchor],
    queryFn:()=>getParentTimetableSummary(range.start,range.end,anchor,studentId),
  });
  if (query.isPending) return <ScreenLoading />;
  if (query.isError || !query.data) return <LiveRouteError error={query.error} onRetry={query.refetch} />;
  return (
    <StudentTimetablePage
      audience="parent"
      dayPlan={query.data.day_plan} selectedDate={query.data.selected_date} onDateChange={date=>{const next=new URLSearchParams(params);next.set('date',date);setParams(next);}}
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
  );
}
