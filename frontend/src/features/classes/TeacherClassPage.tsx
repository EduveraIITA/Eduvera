import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { DateNavigation } from "../../components/date-navigation/DateNavigation";
import { OperationsShell } from "../../pages/operations/OperationsShell";
import { useAuth } from "../auth/AuthContext";
import { currentStaffMembership, hasStaffPermission } from "../auth/staffAccess";
import { getAssignedClass, type TeacherClassSummary } from "../operations/api";
import { ClassLoadState, useClasses } from "./classWorkspace";
import { ClassOverview } from "./ClassOverview";
import { ClassStudents } from "./ClassStudents";
import { ClassNotes } from "./ClassNotes";
import "./classes.css";

function ClassContent({ cls, date, section }: { cls: TeacherClassSummary; date: string; section: string }) {
  const auth = useAuth();
  const member = currentStaffMembership(auth.memberships);
  const roster = useQuery({ queryKey: ["assigned-class", cls.class_section_id, date], queryFn: () => getAssignedClass(cls.class_section_id, date) });
  return <>
    {roster.error ? <ClassLoadState label="Could not load class details. Your access may have changed." retry={() => void roster.refetch()} />
      : section === "overview" ? <ClassOverview cls={cls} date={date} schoolId={member?.school_id ?? ""} canSeeTimetable={hasStaffPermission(member, "timetable.view")} register={roster.data} />
      : roster.isPending ? <ClassLoadState loading label="Loading students" />
      : section === "students" ? <ClassStudents roster={roster.data.roster} />
      : <ClassNotes classId={cls.class_section_id} date={date} />}
  </>;
}

export function AssignedClassPage() {
  const { classId } = useParams();
  const { date, setDate, home, params, setParams } = useClasses();
  const cls = home.data?.classes.find(item => item.class_section_id === classId);
  const section = ["students", "notes"].includes(params.get("section") ?? "") ? params.get("section")! : "overview";
  const backTo = `/areas/people/classes?date=${date}`;
  return <OperationsShell active="areas" title={cls?.class_name ?? "Class details"} backTo={backTo}>
    <div className="classes-workspace">
      <DateNavigation date={date} view="day" compact onDateChange={setDate} />
      {home.isPending ? <ClassLoadState loading label="Loading class details" /> : home.error ? <ClassLoadState label="Could not load your classes." retry={() => void home.refetch()} /> : !cls ? <div className="classes-empty"><p>This class is not available in your assignments for this date.</p><Link to={backTo}>Back to my classes</Link></div> : <>
        <p className="classes-caption">{cls.student_count} students{cls.assignment_kind === "substitute" ? " · Cover assignment" : ""}</p>
        <div className="classes-sections" role="group" aria-label="Class sections">{["overview", "students", "notes"].map(value => <button type="button" key={value} aria-pressed={section === value} onClick={() => { const next = new URLSearchParams(params); next.set("section", value); setParams(next, { replace: true }); }}>{value === "notes" ? "Updates" : value[0]!.toUpperCase() + value.slice(1)}</button>)}</div>
        <ClassContent key={`${classId}:${date}`} cls={cls} date={date} section={section} />
      </>}
    </div>
  </OperationsShell>;
}

export default AssignedClassPage;
