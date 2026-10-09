import type { AgentChartData } from './agentApi';
import { AttendanceTrend,DonutChart,shortDate } from '../analytics/AnalyticsCharts';
import '../analytics/analytics.css';

function AgentBars({chart,compact}:{chart:AgentChartData;compact:boolean}) {
  const points=compact?chart.points.slice(0,4):chart.points;
  const maximum=chart.unit==='percent'?100:Math.max(1,...points.map(point=>point.value??0));
  const value=(reading:number|null)=>reading===null?'Not recorded':`${new Intl.NumberFormat('en-IN',{maximumFractionDigits:1}).format(reading)}${chart.unit==='percent'?'%':''}`;
  return <ul className="agent-chart-bars" aria-label={chart.title}>{points.map((point,index)=><li key={`${point.label}:${index}`} aria-label={`${point.label}: ${value(point.value)}. ${point.detail}`}>
    <div><span>{point.label}</span><strong>{value(point.value)}</strong></div>
    {point.value===null?<span className="agent-chart-bars__missing">No data</span>:<span className="agent-chart-bars__line" aria-hidden="true"><i style={{width:`${Math.max(2,Math.min(100,point.value/maximum*100))}%`}}/></span>}
  </li>)}</ul>;
}

export function AgentChart({chart,compact=false}:{chart:AgentChartData;compact?:boolean}) {
  const tones=['positive','brand','warning','danger','muted'];
  const points=compact&&chart.kind==='bar'?chart.points.slice(0,4):chart.points;
  const value=(n:number|null)=>n===null?'Not recorded':`${new Intl.NumberFormat('en-IN',{maximumFractionDigits:2}).format(n)}${chart.unit==='percent'?'%':''}`;
  return <section className={`agent-chart${compact?' agent-chart--compact':''}`} aria-label={chart.title}>
    <header className="agent-chart__header"><h3>{chart.title}</h3><p className="agent-chart__scope"><span>{chart.scope}</span><span>{shortDate(chart.from)} - {shortDate(chart.to)} {chart.to.slice(0,4)}</span></p></header>
    {chart.kind==='line'?<AttendanceTrend compact attendance={{trend:chart.points.filter(p=>p.date&&p.end).map(p=>({date:p.date!,end:p.end!,percentage:p.value}))}} monthly={chart.interval==='monthly'}/>
      :chart.kind==='donut'?<DonutChart label={chart.title} unit={chart.unit} slices={chart.points.map((p,i)=>({id:String(i),label:p.label,value:p.value??0,tone:tones[i%tones.length]!}))}/>
        :<AgentBars chart={chart} compact={compact}/>}
    {points.length<chart.total?<p className="agent-chart__more">{compact?`${chart.total-points.length} more in full chat`:`Showing ${points.length} of ${chart.total}`}</p>:null}
    {compact&&chart.note.startsWith('Subject attendance')?<p className="agent-chart__note">Estimated from daily attendance</p>:null}
    {!compact?<details className="agent-chart__details"><summary>Data and method</summary><p className="agent-chart__note">{chart.note}</p><div className="analytics-table-wrap"><table><caption>{chart.title}</caption><thead><tr><th scope="col">Item</th><th scope="col">Value</th><th scope="col">Basis</th></tr></thead><tbody>{chart.points.map((p,i)=><tr key={i}><th scope="row">{p.label}</th><td>{value(p.value)}</td><td>{p.detail}</td></tr>)}</tbody></table></div></details>:null}
  </section>;
}
