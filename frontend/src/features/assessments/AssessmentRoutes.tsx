import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { getAccessibleStudents } from "../school/api";
import { LiveRouteError, ScreenLoading } from "../school/LiveRouteState";
import { getFamilyReportCards } from "../academic-reports/api";
import { AssessmentWorkspacePage, FamilyResultsPage } from "./AssessmentWorkspacePage";
import { getAssessmentWorkspace, getFamilyResults } from "./api";
import { AttentionOpenAcknowledgement } from "../attention/AttentionOpenAcknowledgement";
import { AttentionTargetUnavailable } from "../attention/AttentionTargetUnavailable";

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
  const reports=useQuery({queryKey:["academic-reports","family",schoolId,studentId],queryFn:()=>getFamilyReportCards(schoolId,studentId),enabled:Boolean(schoolId&&studentId)});
  const assessmentId=params.get("assessment_id");
  const publicationId=params.get("publication_id");
  const reportBatchId=params.get("report_batch_id");
  const assessmentTarget=Boolean(assessmentId||publicationId);
  const reportTarget=Boolean(reportBatchId);
  const requiredPending=students.isPending||(!studentId&&students.isFetching)
    ||(assessmentTarget?results.isPending:reportTarget?reports.isPending:results.isPending&&reports.isPending);
  if(requiredPending)return <ScreenLoading/>;
  const requiredError=students.error
    ??(assessmentTarget?results.error:reportTarget?reports.error:results.error&&reports.error?results.error:null);
  if(requiredError)return <LiveRouteError error={requiredError} onRetry={async()=>{await students.refetch();await results.refetch();await reports.refetch();}}/>;
  const resultData=results.data??(reports.data?{student:reports.data.student,results:[]}:undefined);
  if(!resultData)return <LiveRouteError error={new Error("Results are unavailable.")} onRetry={async()=>{await results.refetch();await reports.refetch();}}/>;
  const assessmentLoaded=Boolean(assessmentId&&publicationId&&results.data?.results.some((result)=>result.id===assessmentId&&result.publication_id===publicationId));
  const reportLoaded=Boolean(reportBatchId&&reports.data?.reports.some((report)=>report.batch_id===reportBatchId));
  const staleAttention=Boolean(params.get("attention_notification_id")&&(assessmentId||reportBatchId)&&!assessmentLoaded&&!reportLoaded);
  return <>
    {assessmentLoaded||reportLoaded?<AttentionOpenAcknowledgement/>:null}
    {staleAttention?<AttentionTargetUnavailable message="This published result no longer matches an available record. It was not marked as opened."/>:null}
    <FamilyResultsPage key={`${studentId}:${assessmentId??""}:${publicationId??""}:${reportBatchId??""}`} portal={portal} data={resultData} reportCards={reports.data} children={students.data?.results??[]} onSelect={(id)=>{
      const next=new URLSearchParams(params);
      next.set("student_id",id);
      next.delete("assessment_id");
      next.delete("publication_id");
      next.delete("report_batch_id");
      next.delete("attention_notification_id");
      setParams(next);
    }}/>
  </>;
}

export function PrincipalAssessmentsRoute(){return <StaffAssessmentsRoute portal="principal"/>;}
export function TeacherAssessmentsRoute(){return <StaffAssessmentsRoute portal="teacher"/>;}
export function ParentResultsRoute(){return <FamilyResultsRoute portal="parent"/>;}
export function StudentResultsRoute(){return <FamilyResultsRoute portal="student"/>;}
