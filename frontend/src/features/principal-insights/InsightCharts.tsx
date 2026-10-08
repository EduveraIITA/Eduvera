import { useEffect, useRef, useState } from "react";
import type { PrincipalInsights } from "./api";

export const percent=(value:number|null)=>value===null?"Not recorded":`${value.toFixed(1)}%`;
export const shortDate=(date:string)=>new Intl.DateTimeFormat("en-IN",{day:"numeric",month:"short",timeZone:"UTC"}).format(new Date(`${date.slice(0,10)}T12:00:00Z`));
export const money=(paise:number)=>new Intl.NumberFormat("en-IN",{style:"currency",currency:"INR",maximumFractionDigits:0}).format(paise/100);

export function InsightBar({label,value,total,detail,tone="brand"}:{label:string;value:number;total:number;detail:string;tone?:"brand"|"warning"|"mint"}) {
  return <div className="principal-insight-bar"><div><span>{label}</span><strong>{detail}</strong></div><div className="principal-insight-bar__track" aria-hidden="true"><i className={`is-${tone}`} style={{width:`${total>0?Math.min(100,Math.max(0,value/total*100)):0}%`}}/></div></div>;
}

export function AttendanceTrend({daily}:{daily:PrincipalInsights["attendance"]["daily"]}) {
  const ref=useRef<HTMLDivElement>(null);
  const [width,setWidth]=useState(320);
  useEffect(()=>{const el=ref.current;if(!el||typeof ResizeObserver==="undefined") return;const observer=new ResizeObserver(()=>setWidth(Math.max(220,el.clientWidth)));observer.observe(el);return()=>observer.disconnect();},[]);
  const weeks:PrincipalInsights["attendance"]["daily"]=[];
  daily.forEach(day=>{
    const date=new Date(`${day.date}T12:00:00Z`);date.setUTCDate(date.getUTCDate()-(date.getUTCDay()+6)%7);
    const key=date.toISOString().slice(0,10);let week=weeks.find(w=>w.date===key);
    if(!week){week={date:key,expected:0,recorded:0,scored:0,points:0,percentage:null};weeks.push(week);}
    week.expected+=day.expected;week.recorded+=day.recorded;week.scored+=day.scored;week.points+=day.points;
    week.percentage=week.scored?Math.round(week.points/week.scored*1000)/10:null;
  });
  const left=40,right=20,top=16,bottom=150;
  const x=(i:number)=>weeks.length<2?(width+left-right)/2:left+i*(width-left-right)/(weeks.length-1);
  const y=(v:number)=>bottom-v/100*(bottom-top);
  const segments:string[]=[];let segment="";
  weeks.forEach((w,i)=>{if(w.percentage===null){if(segment)segments.push(segment);segment="";}else segment+=`${segment?" L":"M"}${x(i)},${y(w.percentage)}`;});if(segment)segments.push(segment);
  return <div ref={ref} className="principal-trend">
    {weeks.some(w=>w.percentage!==null)?<svg viewBox={`0 0 ${width} 195`} role="img" aria-label="Weekly attendance percentage. Missing records are excluded; see the data table for coverage.">
      {[0,50,100].map(t=><g key={t}><line x1={left} x2={width-right} y1={y(t)} y2={y(t)} className="principal-trend__grid"/><text x={left-8} y={y(t)+4} textAnchor="end">{t}%</text></g>)}
      {segments.map((d,i)=><path key={i} d={d} className="principal-trend__line"/>)}
      {weeks.map((w,i)=><g key={w.date}>{w.percentage!==null?<circle cx={x(i)} cy={y(w.percentage)} r="4"/>:null}{(i===0||i===weeks.length-1||width>480&&i%2===0)?<text x={x(i)} y="172" textAnchor={i===0?"start":i===weeks.length-1?"end":"middle"}>{shortDate(w.date)}</text>:null}</g>)}
      <text x={width/2} y="193" textAnchor="middle">Week beginning · attendance (%)</text>
    </svg>:<p className="principal-insights__empty">Attendance trends appear after registers are recorded.</p>}
    <details className="principal-insights__details"><summary>Weekly values and completeness</summary><div className="principal-insights__table-scroll"><table><caption className="sr-only">Weekly attendance and recorded student-days</caption><thead><tr><th>Week</th><th>Attendance</th><th>Recorded / expected</th></tr></thead><tbody>{weeks.map(w=><tr key={w.date}><td>{shortDate(w.date)}</td><td>{percent(w.percentage)}</td><td>{w.recorded} / {w.expected}</td></tr>)}</tbody></table></div></details>
  </div>;
}
