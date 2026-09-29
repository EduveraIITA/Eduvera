import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { schoolDateToday } from "../../lib/schoolTime";
import {
  PrincipalHomePage,
  PrincipalTimetablePage,
} from "../../pages/operations/PrincipalPages";
import {
  TeacherAttendancePage,
  TeacherHomePage,
  TeacherTimetablePage,
} from "../../pages/operations/TeacherPages";
import { AttendanceWorkspacePage } from "../../pages/operations/AttendanceWorkspacePage";
import {
  createTimetableSlot,
  deleteTimetableSlot,
  getAttendanceRegisterHistory,
  getPrincipalHome,
  getPrincipalTimetable,
  getTeacherAttendance,
  getTeacherHome,
  lockAttendanceRegister,
  saveTeacherAttendance,
  unlockAttendanceRegister,
  updateTimetableSlot,
  type NewTimetableSlot,
  type TeacherAttendanceResponse,
  type TeacherAttendanceSaveInput,
} from "./api";

function Loading() {
  return (
    <div className="route-loader" role="status">
      <span className="route-loader__mark" />
      <span>Loading live school data...</span>
    </div>
  );
}

function Failure({ error }: { error: Error }) {
  return (
    <main className="route-error">
      <h1>This workspace could not load.</h1>
      <p>{error.message}</p>
      <button type="button" onClick={() => location.reload()}>Try again</button>
    </main>
  );
}

function useDateParam() {
  const [params, setParams] = useSearchParams();
  const date = params.get("date") ?? schoolDateToday();
  return [date, (next: string) => {
    const updated = new URLSearchParams(params);
    updated.set("date", next);
    setParams(updated);
  }] as const;
}

export function TeacherHomeRoute() {
  const [date, setDate] = useDateParam();
  const query = useQuery({ queryKey: ["teacher-home", date], queryFn: () => getTeacherHome(date) });
  if (query.isPending) return <Loading />;
  if (query.error) return <Failure error={query.error} />;
  return <TeacherHomePage data={query.data} date={date} onDateChange={setDate} />;
}

export function TeacherTimetableRoute() {
  const query = useQuery({ queryKey: ["teacher-home", "timetable"], queryFn: () => getTeacherHome() });
  if (query.isPending) return <Loading />;
  if (query.error) return <Failure error={query.error} />;
  return <TeacherTimetablePage data={query.data} />;
}

export function TeacherAttendanceRoute() {
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const date = params.get("date") ?? schoolDateToday();
  const classId = params.get("class_section_id");
  const attendanceKey = ["teacher-attendance", classId, date] as const;
  const home = useQuery({
    queryKey: ["teacher-home", date],
    queryFn: () => getTeacherHome(date),
    enabled: !classId,
  });

  const query = useQuery({
    queryKey: attendanceKey,
    queryFn: () => getTeacherAttendance(classId!, date),
    enabled: Boolean(classId),
  });
  const setDate = (next: string) => {
    const updated = new URLSearchParams(params);
    updated.set("date", next);
    setParams(updated);
  };

  if (!classId && home.isPending) return <Loading />;
  if (!classId && home.error) return <Failure error={home.error} />;
  if (!classId && home.data) {
    return <AttendanceWorkspacePage portal="teacher" classes={home.data.classes} date={date} onDateChange={setDate} />;
  }
  if (query.isPending) return <Loading />;
  if (query.error) return <Failure error={query.error} />;

  const refresh = async () => {
    const latest = await getTeacherAttendance(classId!, date);
    queryClient.setQueryData(attendanceKey, latest);
    return latest;
  };
  const save = async (input: TeacherAttendanceSaveInput) => {
    const updated = await saveTeacherAttendance(classId!, date, input);
    queryClient.setQueryData(attendanceKey, updated);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["teacher-home"] }),
      queryClient.invalidateQueries({ queryKey: ["principal-home"] }),
    ]);
    return updated;
  };

  return (
    <TeacherAttendancePage
      key={`${query.data.class.id}-${date}`}
      data={query.data}
      date={date}
      onDateChange={setDate}
      onSave={save}
      onRefresh={refresh}
    />
  );
}

export function PrincipalHomeRoute() {
  const [date, setDate] = useDateParam();
  const query = useQuery({ queryKey: ["principal-home", date], queryFn: () => getPrincipalHome(date) });
  if (query.isPending) return <Loading />;
  if (query.error) return <Failure error={query.error} />;
  return <PrincipalHomePage data={query.data} date={date} onDateChange={setDate} />;
}

export function PrincipalAttendanceRoute() {
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const date = params.get("date") ?? schoolDateToday();
  const classId = params.get("class_section_id");
  const registerKey = ["principal-register", classId, date] as const;
  const historyKey = ["principal-register-history", classId, date] as const;
  const home = useQuery({
    queryKey: ["principal-home", date],
    queryFn: () => getPrincipalHome(date),
    enabled: !classId,
  });
  const roster = useQuery({
    queryKey: registerKey,
    queryFn: () => getTeacherAttendance(classId!, date),
    enabled: Boolean(classId),
  });
  const loadHistory = useCallback(() => queryClient.fetchQuery({
    queryKey: ["principal-register-history", classId, date],
    queryFn: () => getAttendanceRegisterHistory(classId!, date),
    staleTime: 0,
  }), [classId, date, queryClient]);
  const setDate = (next: string) => {
    const updated = new URLSearchParams(params);
    updated.set("date", next);
    setParams(updated);
  };

  if (classId) {
    if (roster.isPending) return <Loading />;
    if (roster.error) return <Failure error={roster.error} />;

    const storeResult = async (request: Promise<TeacherAttendanceResponse>) => {
      const updated = await request;
      queryClient.setQueryData(registerKey, updated);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["principal-home"] }),
        queryClient.invalidateQueries({ queryKey: ["teacher-home"] }),
        queryClient.invalidateQueries({ queryKey: historyKey }),
      ]);
      return updated;
    };

    return (
      <TeacherAttendancePage
        key={`${roster.data.class.id}-${date}`}
        portal="principal"
        data={roster.data}
        date={date}
        onDateChange={setDate}
        onRefresh={async () => {
          const latest = await getTeacherAttendance(classId, date);
          queryClient.setQueryData(registerKey, latest);
          return latest;
        }}
        onSave={(input) => storeResult(saveTeacherAttendance(classId, date, input))}
        onLock={() => storeResult(lockAttendanceRegister(classId, date))}
        onUnlock={(reason) => storeResult(unlockAttendanceRegister(classId, date, reason))}
        onLoadHistory={loadHistory}
      />
    );
  }
  if (home.isPending) return <Loading />;
  if (home.error) return <Failure error={home.error} />;
  return <AttendanceWorkspacePage portal="principal" classes={home.data.classes} date={date} onDateChange={setDate} />;
}

export function PrincipalTimetableRoute() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["principal-timetable"], queryFn: getPrincipalTimetable });
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["principal-timetable"] });
    await query.refetch();
  };
  const create = useMutation({ mutationFn: (slot: NewTimetableSlot) => createTimetableSlot(slot) });
  const update = useMutation({ mutationFn: ({ id, slot }: { id: string; slot: NewTimetableSlot }) => updateTimetableSlot(id, slot) });
  const remove = useMutation({ mutationFn: deleteTimetableSlot });
  if (query.isPending) return <Loading />;
  if (query.error) return <Failure error={query.error} />;
  return (
    <PrincipalTimetablePage
      data={query.data}
      onCreate={async (slot) => { await create.mutateAsync(slot); await refresh(); }}
      onUpdate={async (id, slot) => { await update.mutateAsync({ id, slot }); await refresh(); }}
      onDelete={async (id) => { await remove.mutateAsync(id); await refresh(); }}
    />
  );
}
