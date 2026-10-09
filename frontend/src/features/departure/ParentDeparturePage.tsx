import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { ParentShell } from "../../pages/parent/ParentShell";
import { StudentShell } from "../../pages/student/StudentShell";
import { useAuth } from "../auth/AuthContext";
import { LiveRouteError, ScreenLoading } from "../school/LiveRouteState";
import { getFamilyDeparture, getStudentDeparture } from "./api";
import { FamilyDepartureContent } from "./FamilyDepartureContent";
import "./departure.css";

export default function ParentDeparturePage({student=false}:{student?:boolean}) {
  const auth=useAuth();const [params,setParams]=useSearchParams();const studentId=params.get("student_id")??undefined;const date=params.get("date")??undefined;
  const query=useQuery({queryKey:["departure",student?"student":"family",auth.user?.id,studentId,date],queryFn:()=>student?getStudentDeparture(date):getFamilyDeparture(studentId,date),refetchInterval:10_000});
  if(query.isPending)return <ScreenLoading/>;
  if(query.error||!query.data)return <LiveRouteError error={query.error??new Error("Departure information is unavailable.")} onRetry={query.refetch}/>;
  const data=query.data;
  const child={id:data.student.id,name:[data.student.first_name,data.student.last_name].join(" ").trim(),grade:data.student.grade??"",section:data.student.section??"",board:"",rollNumber:"",avatarUrl:data.student.avatar_url};
  const content=<div className="departure-page">
    <label className="departure-date">Service date<input type="date" value={data.service_date} onChange={event=>{if(!event.target.value)return;const next=new URLSearchParams(params);next.set("date",event.target.value);setParams(next);}}/></label>
    <FamilyDepartureContent key={data.student.id+":"+data.service_date} data={data} actorId={auth.user?.id??""}/>
  </div>;
  return student?<StudentShell activeNav="launcher" section="Departure & bus" className={"Class "+child.grade+child.section}>{content}</StudentShell>:<ParentShell active="more" pageLabel="Departure & bus" backTo="/parent/more" child={child} selectedChildId={data.student.id} childOptions={data.children.map(item=>({id:item.id,name:[item.first_name,item.last_name].join(" ").trim(),grade:item.grade??"",section:item.section??"",avatarUrl:item.avatar_url}))} onSelectChild={id=>{const next=new URLSearchParams(params);next.set("student_id",id);setParams(next);}}>{content}</ParentShell>;
}
