import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { schoolDateToday } from "../../lib/schoolTime";
import {
  PrincipalHomePage,
} from "../../pages/operations/PrincipalPages";
import { PrincipalTimetablePage } from "../../pages/operations/TimetableBuilderPage";
import { OperationsShell } from "../../pages/operations/OperationsShell";
import {
  TeacherAttendancePage,
  TeacherHomePage,
  TeacherTimetablePage,
} from "../../pages/operations/TeacherPages";
import { AttendanceWorkspacePage } from "../../pages/operations/AttendanceWorkspacePage";
import { ApiError } from "../../lib/api";
import { useAuth } from "../auth/AuthContext";
import { ScopedStaffHomePage } from "../auth/ScopedStaffHomePage";
import { currentStaffMembership, hasStaffPermission } from "../auth/staffAccess";
import {
  applyQueuedCapture,
  attendanceDeviceId,
  cacheAttendanceSnapshot,
  queueAttendanceCapture,
  readAttendanceSnapshot,
  readQueuedAttendanceCapture,
  removeQueuedAttendanceCapture,
} from "../attendance/attendanceOfflineStore";
import {
  createTimetableSlot,
  createSchoolClosure,
  copyTimetableDay,
  decideAttendanceReconciliation,
  deleteSchoolClosure,
  deleteTimetableSlot,
  getAttendanceContinuityWorkspace,
  getAttendanceRegisterHistory,
  getPrincipalHome,
  getPrincipalTimetable,
  getTeacherAttendance,
  getTeacherHome,
  lockAttendanceRegister,
  saveAttendanceContinuityBatch,
  saveCurriculumTarget,
  unlockAttendanceRegister,
  updateTimetableSlot,
  type NewTimetableSlot,
  type CurriculumTargetInput,
  type SchoolClosureInput,
  type TeacherAttendanceResponse,
  type TeacherAttendanceSaveInput,
} from "./api";

async function attendanceWithOfflineFallback(ownerId: string, classSectionId: string, date: string) {
  try {
    const live = await getTeacherAttendance(classSectionId, date);
    await cacheAttendanceSnapshot(ownerId, live).catch(() => undefined);
    const queued = await readQueuedAttendanceCapture(ownerId, classSectionId, date).catch(() => null);
    return queued ? applyQueuedCapture(live, queued) : live;
  } catch (error) {
    // A current authorization or validation refusal must win over the cache.
    // Offline fallback is only for connectivity/server interruptions, never a
    // way to reopen a roster after the school has revoked access.
    if (error instanceof ApiError && error.status < 500) throw error;
    const cached = await readAttendanceSnapshot(ownerId, classSectionId, date).catch(() => null);
    if (!cached) throw error;
    const queued = await readQueuedAttendanceCapture(ownerId, classSectionId, date).catch(() => null);
    return queued ? applyQueuedCapture(cached, queued) : cached;
  }
}

async function submitAttendanceWithContinuity(
  ownerId: string,
  screen: TeacherAttendanceResponse,
  classSectionId: string,
  date: string,
  input: TeacherAttendanceSaveInput,
) {
  const source = !navigator.onLine && (!input.source || input.source === "live_app")
    ? "offline_device"
    : input.source ?? "live_app";
  const deviceId = source === "offline_device" ? await attendanceDeviceId(ownerId) : null;
  const captureInput: TeacherAttendanceSaveInput = {
    ...input,
    source,
    device_id: input.device_id ?? deviceId,
    observed_at: input.observed_at ?? new Date().toISOString(),
    roster_fingerprint: input.roster_fingerprint ?? screen.continuity_snapshot.roster_fingerprint,
    roster_captured_at: input.roster_captured_at ?? screen.continuity_snapshot.captured_at,
    roster_expires_at: input.roster_expires_at ?? screen.continuity_snapshot.expires_at,
    snapshot_token: input.snapshot_token ?? screen.continuity_snapshot.token,
  };
  const localCapture = {
    id: input.idempotency_key,
    ownerId,
    classSectionId,
    date,
    createdAt: new Date().toISOString(),
    input: captureInput,
    screen,
  };
  try {
    const result = await saveAttendanceContinuityBatch(classSectionId, date, captureInput);
    await removeQueuedAttendanceCapture(ownerId, classSectionId, date).catch(() => undefined);
    if (result.status === "accepted" && result.register) {
      await cacheAttendanceSnapshot(ownerId, result.register).catch(() => undefined);
      return result.register;
    }
    return {
      ...applyQueuedCapture(screen, localCapture),
      latest_capture: {
        id: result.batch.id,
        source: result.batch.source,
        status: result.status,
        received_at: result.batch.received_at,
        roster_expires_at: result.batch.roster_expires_at,
      },
    };
  } catch (error) {
    if (error instanceof ApiError && error.status < 500) throw error;
    await queueAttendanceCapture(localCapture);
    return applyQueuedCapture(screen, localCapture);
  }
}

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
  const auth = useAuth();
  const member = currentStaffMembership(auth.memberships);
  if (!member) return null;
  if (!hasStaffPermission(member, "timetable.view")) return <ScopedStaffHomePage member={member} />;
  return <TeachingDayHomeRoute />;
}

function TeachingDayHomeRoute() {
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
  const auth = useAuth();
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
    queryFn: () => attendanceWithOfflineFallback(auth.user!.id, classId!, date),
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
    const latest = await attendanceWithOfflineFallback(auth.user!.id, classId!, date);
    queryClient.setQueryData(attendanceKey, latest);
    return latest;
  };
  const save = async (input: TeacherAttendanceSaveInput) => {
    const updated = await submitAttendanceWithContinuity(auth.user!.id, query.data, classId!, date, input);
    queryClient.setQueryData(attendanceKey, updated);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["teacher-home"] }),
      queryClient.invalidateQueries({ queryKey: ["principal-home"] }),
    ]);
    return updated;
  };

  return (
    <TeacherAttendancePage
      key={`${query.data.class.id}-${date}-${params.get('student_id')??''}`}
      initialStudentId={params.get('student_id')??undefined}
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
  const auth = useAuth();
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
  const continuity = useQuery({
    queryKey: ["attendance-continuity", date],
    queryFn: () => getAttendanceContinuityWorkspace(date),
    enabled: !classId,
  });
  const roster = useQuery({
    queryKey: registerKey,
    queryFn: () => attendanceWithOfflineFallback(auth.user!.id, classId!, date),
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
        key={`${roster.data.class.id}-${date}-${params.get('student_id')??''}`}
        initialStudentId={params.get('student_id')??undefined}
        portal="principal"
        initialCaptureSource={params.get("source") === "paper" ? "paper" : "live_app"}
        data={roster.data}
        date={date}
        onDateChange={setDate}
        onRefresh={async () => {
          const latest = await attendanceWithOfflineFallback(auth.user!.id, classId, date);
          queryClient.setQueryData(registerKey, latest);
          return latest;
        }}
        onSave={(input) => storeResult(submitAttendanceWithContinuity(auth.user!.id, roster.data, classId, date, input))}
        onLock={() => storeResult(lockAttendanceRegister(classId, date))}
        onUnlock={(reason) => storeResult(unlockAttendanceRegister(classId, date, reason))}
        onLoadHistory={loadHistory}
      />
    );
  }
  if (home.isPending) return <Loading />;
  if (home.error) return <Failure error={home.error} />;
  return <AttendanceWorkspacePage
    portal="principal"
    classes={home.data.classes}
    date={date}
    onDateChange={setDate}
    continuity={continuity.data}
    continuityLoading={continuity.isPending}
    continuityError={continuity.error ?? null}
    onContinuityDecision={async (caseId, decision, reason, expectedRevision) => {
      const updated = await decideAttendanceReconciliation(caseId, { decision, reason, expected_revision: expectedRevision });
      queryClient.setQueryData(["attendance-continuity", date], updated);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["principal-home"] }),
        queryClient.invalidateQueries({ queryKey: ["teacher-home"] }),
        queryClient.invalidateQueries({ queryKey: ["principal-register"] }),
      ]);
    }}
  />;
}

export { ScheduleSettingsRoute as PrincipalTimetableRoute } from "../schedule-planning/ScheduleSettingsRoute";

export function LegacyPrincipalTimetableRoute() {
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const termId = params.get("term") || undefined;
  const query = useQuery({ queryKey: ["principal-timetable", termId ?? "current"], queryFn: () => getPrincipalTimetable(termId) });
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["principal-timetable"] });
    await query.refetch();
  };
  const create = useMutation({ mutationFn: (slot: NewTimetableSlot) => createTimetableSlot(slot) });
  const update = useMutation({ mutationFn: ({ id, slot }: { id: string; slot: NewTimetableSlot }) => updateTimetableSlot(id, slot) });
  const remove = useMutation({ mutationFn: deleteTimetableSlot });
  const copy = useMutation({ mutationFn: copyTimetableDay });
  const target = useMutation({ mutationFn: (input: CurriculumTargetInput) => saveCurriculumTarget(input) });
  const closure = useMutation({ mutationFn: (input: SchoolClosureInput) => createSchoolClosure(input) });
  const removeClosure = useMutation({ mutationFn: ({ date, revision, reason }: { date: string; revision: number; reason: string }) => deleteSchoolClosure(date, revision, reason) });
  if (query.isPending || query.error) {
    const backParams = new URLSearchParams();
    for (const key of ["school", "date", "class", "view"]) if (params.has(key)) backParams.set(key, params.get(key)!);
    return <OperationsShell portal="principal" active="timetable" title="Edit timetable" backTo={`/principal/timetable${backParams.size ? `?${backParams}` : ""}`}>
      {query.isPending ? <div className="timetable-builder__loading" role="status" aria-label="Loading timetable"><span /><span /><span /></div>
        : <section className="timetable-builder__empty-page"><h2>Timetable could not be loaded</h2><p role="alert">{query.error?.message}</p><button className="timetable-builder__retry" type="button" onClick={() => void query.refetch()}>Try again</button></section>}
    </OperationsShell>;
  }
  return (
    <PrincipalTimetablePage
      data={query.data}
      onTermChange={(nextTermId) => { const next = new URLSearchParams(params); next.set("term", nextTermId); setParams(next); }}
      onCreate={async (slot) => { await create.mutateAsync(slot); await refresh(); }}
      onUpdate={async (id, slot) => { await update.mutateAsync({ id, slot }); await refresh(); }}
      onDelete={async (id) => { await remove.mutateAsync(id); await refresh(); }}
      onCopy={async (input) => { const result = await copy.mutateAsync(input); await refresh(); return result; }}
      onSaveTarget={async (input) => { await target.mutateAsync(input); await refresh(); }}
      onCreateClosure={async (input) => { await closure.mutateAsync(input); await refresh(); }}
      onDeleteClosure={async (date, revision, reason) => { await removeClosure.mutateAsync({ date, revision, reason }); await refresh(); }}
    />
  );
}
