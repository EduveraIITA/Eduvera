import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { getAccessibleStudents } from "../school/api";
import { LiveRouteError, ScreenLoading } from "../school/LiveRouteState";
import { getFamilyReportCards } from "../academic-reports/api";
import { AssessmentWorkspacePage } from "./AssessmentWorkspacePage";
import { FamilyResultsPage } from "./FamilyResultsPage";
import { getAssessmentWorkspace, getFamilyResults } from "./api";
import { AttentionOpenAcknowledgement } from "../attention/AttentionOpenAcknowledgement";
import { AttentionTargetUnavailable } from "../attention/AttentionTargetUnavailable";
import { searchForStudentContext } from "../navigation/studentContextSearch";
import { useOptionalExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { LIVE_EXECUTION_ENVIRONMENT } from "../simulation/executionEnvironment";
import { executionEnvironmentQueryKey } from "../simulation/executionEnvironmentQueryKey";

type AssessmentPresentation = "legacy" | "workspace";

function activeSchool(auth: ReturnType<typeof useAuth>) {
  const activeSchoolId = auth.user?.active_school_id;
  return auth.memberships.find((item) => item.school_id === activeSchoolId) ?? auth.memberships[0];
}

export function StaffAssessmentsRoute({
  portal,
  presentation = "legacy",
  surface,
}:{
  portal?:"principal"|"teacher";
  presentation?: AssessmentPresentation;
  surface?: "assigned" | "manage";
}){
  const auth=useAuth();
  const environment=useOptionalExecutionEnvironment()??LIVE_EXECUTION_ENVIRONMENT;
  const role=portal==="principal"?"admin":"staff";
  const membership=presentation==="workspace"
    ? activeSchool(auth)
    : auth.memberships.find((item)=>item.role===role);
  const schoolId=membership?.school_id??"";
  const unavailable=environment.mode==="simulation"&&environment.unavailable===true;
  const query=useQuery({queryKey:unavailable?["assessment-unavailable",auth.user?.id,schoolId]:executionEnvironmentQueryKey(environment,["assessments",schoolId,"actor",auth.user?.id]),queryFn:()=>getAssessmentWorkspace(schoolId),enabled:Boolean(schoolId)&&!unavailable});
  if(unavailable)return <LiveRouteError error={new Error("This simulation is unavailable. Recover it before opening assessments.")} onRetry={auth.refresh}/>;
  if(!schoolId)return <LiveRouteError error={new Error("Active institution access is required.")} onRetry={auth.refresh}/>;
  if(query.isPending)return <ScreenLoading/>; if(query.error||!query.data)return <LiveRouteError error={query.error??new Error("Assessment workspace unavailable.")} onRetry={query.refetch}/>;
  return <AssessmentWorkspacePage portal={portal} presentation={presentation} surface={surface} schoolId={schoolId} schoolName={membership?.school_name} data={query.data} refresh={async()=>{await query.refetch();}}/>;
}

export function FamilyResultsRoute({portal,presentation="legacy"}:{portal?:"parent"|"student";presentation?:AssessmentPresentation}){
  const auth=useAuth(); const [params,setParams]=useSearchParams();
  const environment=useOptionalExecutionEnvironment()??LIVE_EXECUTION_ENVIRONMENT;
  const unavailable=environment.mode==="simulation"&&environment.unavailable===true;
  const key=(parts:readonly unknown[])=>unavailable?["assessment-unavailable",auth.user?.id,...parts]:executionEnvironmentQueryKey(environment,[...parts,"actor",auth.user?.id]);
  const membership=presentation==="workspace"
    ? activeSchool(auth)
    : auth.memberships.find((item)=>item.role===(portal==="parent"?"guardian":"student"));
  const schoolId=membership?.school_id??"";
  const students=useQuery({queryKey:key(["school","accessible-students"]),queryFn:getAccessibleStudents,enabled:!unavailable});
  const requestedStudentId=params.get("student_id");
  const studentId=requestedStudentId??students.data?.results[0]?.id??"";
  const results=useQuery({queryKey:key(["assessments","family",schoolId,studentId]),queryFn:()=>getFamilyResults(schoolId,studentId),enabled:Boolean(schoolId&&studentId)&&!unavailable});
  const reports=useQuery({queryKey:key(["academic-reports","family",schoolId,studentId]),queryFn:()=>getFamilyReportCards(schoolId,studentId),enabled:Boolean(schoolId&&studentId)&&!unavailable});
  const assessmentId=params.get("assessment_id");
  const publicationId=params.get("publication_id");
  const reportBatchId=params.get("report_batch_id");
  const assessmentTarget=Boolean(assessmentId||publicationId);
  const reportTarget=Boolean(reportBatchId);
  const requiredPending=students.isPending||(!studentId&&students.isFetching)
    ||(assessmentTarget?results.isPending:reportTarget?reports.isPending:results.isPending||reports.isPending);
  if(unavailable)return <LiveRouteError error={new Error("This simulation is unavailable. Recover it before opening results.")} onRetry={auth.refresh}/>;
  if(requiredPending)return <ScreenLoading/>;
  const requiredError=students.error
    ??(assessmentTarget?results.error:reportTarget?reports.error:results.error&&reports.error?results.error:null);
  if(requiredError)return <LiveRouteError error={requiredError} onRetry={async()=>{await students.refetch();await results.refetch();await reports.refetch();}}/>;
  const resultData=results.data??(reports.data?{student:reports.data.student,results:[]}:undefined);
  if(!resultData)return <LiveRouteError error={new Error("Results are unavailable.")} onRetry={async()=>{await results.refetch();await reports.refetch();}}/>;
  const assessmentLoaded=Boolean(assessmentId&&publicationId&&results.data?.results.some((result)=>result.id===assessmentId&&result.publication_id===publicationId));
  const reportLoaded=Boolean(reportBatchId&&reports.data?.reports.some((report)=>report.batch_id===reportBatchId));
  const staleAttention=Boolean(params.get("attention_notification_id")&&(assessmentId||reportBatchId)&&!assessmentLoaded&&!reportLoaded);
  const partialFailure=!assessmentTarget&&!reportTarget&&(results.error||reports.error);
  const sourceNotice=partialFailure?<div className="results-source-notice" role="status"><p>{results.error?"Assessment results couldn’t be loaded. Term reports are available.":"Term reports couldn’t be loaded. Assessment results are available."}</p><button type="button" disabled={results.isFetching||reports.isFetching} onClick={()=>{if(results.error)void results.refetch();if(reports.error)void reports.refetch();}}>Retry</button></div>:undefined;
  return <>
    {assessmentLoaded||reportLoaded?<AttentionOpenAcknowledgement/>:null}
    {staleAttention?<AttentionTargetUnavailable message="This published result no longer matches an available record. It was not marked as opened."/>:null}
    <FamilyResultsPage key={`${studentId}:${assessmentId??""}:${publicationId??""}:${reportBatchId??""}`} portal={portal} presentation={presentation} data={resultData} reportCards={reports.data} sourceNotice={sourceNotice} children={students.data?.results??[]} onSelect={(id)=>{
      setParams(searchForStudentContext(params, id), { replace: true });
    }}/>
  </>;
}

export function PrincipalAssessmentsRoute(){return <StaffAssessmentsRoute portal="principal"/>;}
export function TeacherAssessmentsRoute(){return <StaffAssessmentsRoute portal="teacher"/>;}
export function ParentResultsRoute(){return <FamilyResultsRoute portal="parent"/>;}
export function StudentResultsRoute(){return <FamilyResultsRoute portal="student"/>;}
export function WorkspaceAssignedAssessmentsRoute(){return <StaffAssessmentsRoute presentation="workspace" surface="assigned"/>;}
export function WorkspaceManagedAssessmentsRoute(){return <StaffAssessmentsRoute presentation="workspace" surface="manage"/>;}
export function WorkspaceFamilyResultsRoute(){return <FamilyResultsRoute presentation="workspace"/>;}
