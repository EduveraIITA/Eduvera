import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { ParentShell } from "../../pages/parent/ParentShell";
import { StudentShell } from "../../pages/student/StudentShell";
import { useAuth } from "../auth/AuthContext";
import { LiveRouteError, ScreenLoading } from "../school/LiveRouteState";
import { getFamilyDeparture, getStudentDeparture } from "./api";
import { FamilyDepartureContent } from "./FamilyDepartureContent";
import { AttentionOpenAcknowledgement } from "../attention/AttentionOpenAcknowledgement";
import { AttentionTargetUnavailable } from "../attention/AttentionTargetUnavailable";
import { searchForStudentContext } from "../navigation/studentContextSearch";
import "./departure.css";

import { TemporalInput } from "../../components/forms/TemporalInput";
export default function ParentDeparturePage({student=false}:{student?:boolean}) {
  const auth=useAuth();const [params,setParams]=useSearchParams();const studentId=params.get("student_id")??undefined;const date=params.get("date")??undefined;
  const attentionNotificationId=params.get("attention_notification_id");
  const requestId=params.get("request_id")??undefined;const tripId=params.get("trip_id")??undefined;const planId=params.get("plan_id")??undefined;
  const expectedRequestRevision=Number(params.get("request_revision"));const expectedTripRevision=Number(params.get("trip_revision"));const expectedRiderRevision=Number(params.get("rider_revision"));const expectedPlanRevision=Number(params.get("plan_revision"));
  const query=useQuery({queryKey:["departure",student?"student":"family",auth.user?.id,studentId,date,requestId],queryFn:()=>student?getStudentDeparture(date):getFamilyDeparture(studentId,date,requestId),refetchInterval:10_000});
  if(query.isPending)return <ScreenLoading/>;
  if(query.error||!query.data)return <LiveRouteError error={query.error??new Error("Departure information is unavailable.")} onRetry={query.refetch}/>;
  const data=query.data;
  const exactRequest=requestId?data.requests.some(request=>request.id===requestId&&["approved","rejected"].includes(request.status)&&request.revision===expectedRequestRevision):false;
  const exactTrip=tripId?data.journeys.some(journey=>journey.id===tripId&&(
    Number.isInteger(expectedTripRevision)&&expectedTripRevision>0?journey.state==="cancelled"&&journey.revision===expectedTripRevision:
      Number.isInteger(expectedRiderRevision)&&expectedRiderRevision>0&&journey.rider_state==="exception"&&journey.rider_revision===expectedRiderRevision
  )):false;
  const exactPlan=planId?data.plan?.id===planId&&data.plan.state==="exception"&&data.plan.revision===expectedPlanRevision:false;
  const exactAttentionTarget=exactRequest||exactTrip||exactPlan;
  const staleAttentionTarget=Boolean(attentionNotificationId&&(requestId||tripId||planId)&&!exactAttentionTarget);
  const focus=exactRequest&&requestId?{requestId}:exactTrip&&tripId?{tripId}:exactPlan&&planId?{planId}:undefined;
  const child={id:data.student.id,name:[data.student.first_name,data.student.last_name].join(" ").trim(),grade:data.student.grade??"",section:data.student.section??"",board:"",rollNumber:"",avatarUrl:data.student.avatar_url};
  const content=<div className="departure-page">
    <label className="departure-date">Service date<TemporalInput type="date" value={data.service_date} onChange={event=>{if(!event.target.value)return;const next=new URLSearchParams(params);next.set("date",event.target.value);setParams(next,{replace:true});}}/></label>
    {staleAttentionTarget?<AttentionTargetUnavailable message="This update no longer matches the current departure record. It was not marked as opened."/>:null}
    {exactAttentionTarget?<AttentionOpenAcknowledgement/>:null}
    <FamilyDepartureContent key={data.student.id+":"+data.service_date} data={data} actorId={auth.user?.id??""} {...focus?{focus}:{}}/>
  </div>;
  return student?<StudentShell activeNav="launcher" section="Departure & bus" className={"Class "+child.grade+child.section}>{content}</StudentShell>:<ParentShell active="more" pageLabel="Departure & bus" backTo="/parent/more" child={child} selectedChildId={data.student.id} childOptions={data.children.map(item=>({id:item.id,name:[item.first_name,item.last_name].join(" ").trim(),grade:item.grade??"",section:item.section??"",avatarUrl:item.avatar_url}))} onSelectChild={id=>setParams(searchForStudentContext(params,id), { replace: true })}>{content}</ParentShell>;
}
