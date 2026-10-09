import { z } from 'zod';

export const chartChoice=z.enum(['attendance_trend','attendance_breakdown','attendance_comparison','results_comparison','results_distribution','none']);
export interface AgentChart {
  kind:'line'|'bar'|'donut'; title:string; scope:string; from:string; to:string; unit:'percent'|'records';
  points:Array<{label:string;value:number|null;detail:string;date?:string;end?:string}>;
  note:string; total:number; shown:number;
  interval?:'monthly'|'weekly';
}
/** Visualization is a projection of verified API data, never model-supplied values. */
export function analyticsChart(capability:string,input:Record<string,unknown>,data:any):AgentChart|undefined {
  if(!['insights','principal_analytics'].includes(capability)||data?.status==='choose_student'||data?.status==='choose_class'||input.chart==='none')return;
  const range=data?.range;
  if(!z.iso.date().safeParse(range?.from).success||!z.iso.date().safeParse(range?.to).success)return;
  const choice=input.chart??(input.topic==='results'?'results_comparison':'attendance_comparison');
  const attendance=data.attendance,results=data.results??data.assessments;
  let kind:AgentChart['kind']='bar',title='Recorded attendance by subject',unit:AgentChart['unit']='percent';
  let points:AgentChart['points']=[],total=0;
  let note='Only recorded data. Missing values are not zero.';
  if(choice==='attendance_trend'&&attendance) {
    kind='line';title='Recorded attendance trend';
    points=(attendance.trend??[]).map((p:any)=>({label:`${p.date} – ${p.end}`,date:p.date,end:p.end,value:p.percentage,detail:`${p.attended} of ${p.denominator} student-days`}));
  } else if(choice==='attendance_breakdown'&&attendance) {
    kind='donut';title='Attendance records';unit='records';
    points=['present','late','half_day','absent','excused'].map(key=>({label:key.replace('_',' '),value:attendance[key],detail:'Recorded student-days'}));
    note='Each record appears once. Half-day records count as half a day in the attendance percentage; excused records are excluded from its denominator.';
  } else if(choice==='results_distribution'&&results) {
    kind='donut';title='Published score distribution';unit='records';
    points=['Below 20%','20–<40%','40–<60%','60–<80%','80–100%'].map((label,i)=>({label,value:results.overall.distribution[i],detail:'Scored results'}));
    note='Latest published scored results, not students or official grades. Missing scores excluded.';
  } else if(choice==='results_comparison'&&results) {
    title=`Published average by ${input.group_by==='class'?'class':'subject'}`;
    const rows=results.comparison?.items??results.subjects??[];total=results.comparison?.total??rows.length;
    points=rows.map((p:any)=>({label:p.name,value:p.average,detail:`${p.scored} scored results`}));
    note='Mean published result percentages, not official report-card grades. Missing scores excluded.';
  } else if(choice==='attendance_comparison'&&attendance) {
    title=`Recorded attendance by ${input.group_by==='class'?'class':'subject'}`;
    const rows=attendance.comparison?.items??attendance.subjects??[];total=attendance.comparison?.total??rows.length;
    points=rows.map((p:any)=>({label:p.name,value:p.percentage,detail:`${p.attended} of ${p.denominator??p.counted} ${input.group_by==='class'?'student-days':'projected lessons'}`}));
    note=input.group_by==='class'?'Recorded student-days; missing records are not absences.':'Subject attendance is projected from daily records and scheduled lessons, not direct lesson observations.';
  }
  if(!points.length||points.some(p=>typeof p.label!=='string'||p.value!==null&&(!Number.isFinite(p.value)||p.value<0||unit==='percent'&&p.value>100)))return;
  total=total||points.length;
  // Donuts must be a complete partition; never draw a partial pie.
  if(kind==='donut'&&points.some(p=>p.value===null))return;
  points=points.slice(0,kind==='bar'?8:24);
  return {kind,title,unit,scope:data.scope??data.scope_label??'Authorized records',from:range.from,to:range.to,points,note,total,shown:points.length,...(kind==='line'?{interval:range.period==='term'?'monthly' as const:'weekly' as const}:{})};
}
