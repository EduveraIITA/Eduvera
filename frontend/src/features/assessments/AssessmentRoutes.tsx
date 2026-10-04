import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { getAccessibleStudents } from "../school/api";
import { LiveRouteError, ScreenLoading } from "../school/LiveRouteState";
import { AssessmentWorkspacePage, FamilyResultsPage } from "./AssessmentWorkspacePage";
import { getAssessmentWorkspace, getFamilyResults } from "./api";

export function StaffAssessmentsRoute({portal}:{portal:"principal"|"teacher"}){
  const auth=useAuth(); const role=portal==="principal"?"admin":"staff"; const membership=auth.memberships.find((item)=>item.role===role); const schoolId=membership?.school_id??"";
  const query=useQuery({queryKey:["assessments",schoolId],queryFn:()=>getAssessmentWorkspace(schoolId),enabled:Boolean(schoolId)});
  if(!schoolId)return <LiveRouteError error={new Error("Active institution access is required.")} onRetry={auth.refresh}/>;
  if(query.isPending)return <ScreenLoading/>; if(query.error||!query.data)return <LiveRouteError error={query.error??new Error("Assessment workspace unavailable.")} onRetry={query.refetch}/>;
  return <AssessmentWorkspacePage portal={portal} schoolId={schoolId} schoolName={membership?.school_name} data={query.data} refresh={async()=>{await query.refetch();}}/>;
}

export function FamilyResultsRoute({portal}:{portal:"parent"|"student"}){
  const auth=useAuth(); const [params,setParams]=useSearchParams(); const membership=auth.memberships.find((item)=>item.role===(portal==="parent"?"guardian":"student")); const schoolId=membership?.school_id??"";
  const students=useQuery({queryKey:["school","accessible-students"],queryFn:getAccessibleStudents});
  const studentId=params.get("student_id")??students.data?.results[0]?.id??"";
  const results=useQuery({queryKey:["assessments","family",schoolId,studentId],queryFn:()=>getFamilyResults(schoolId,studentId),enabled:Boolean(schoolId&&studentId)});
  if(students.isPending||(!studentId&&students.isFetching)||results.isPending)return <ScreenLoading/>;
  if(students.error||results.error||!results.data)return <LiveRouteError error={students.error??results.error??new Error("Results are unavailable.")} onRetry={async()=>{await students.refetch();await results.refetch();}}/>;
  return <FamilyResultsPage portal={portal} data={results.data} children={students.data?.results??[]} onSelect={(id)=>{const next=new URLSearchParams(params);next.set("student_id",id);setParams(next);}}/>;
}

export function PrincipalAssessmentsRoute(){return <StaffAssessmentsRoute portal="principal"/>;}
export function TeacherAssessmentsRoute(){return <StaffAssessmentsRoute portal="teacher"/>;}
export function ParentResultsRoute(){return <FamilyResultsRoute portal="parent"/>;}
export function StudentResultsRoute(){return <FamilyResultsRoute portal="student"/>;}
