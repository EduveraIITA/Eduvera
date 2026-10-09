import type { AgentChartData } from './agentApi';
import { AttendanceTrend,ComparisonBars,DonutChart,shortDate } from '../analytics/AnalyticsCharts';
import '../analytics/analytics.css';

export function AgentChart({chart,compact=false}:{chart:AgentChartData;compact?:boolean}) {
  const tones=['positive','brand','warning','danger','muted'];
  const points=compact&&chart.kind==='bar'?chart.points.slice(0,4):chart.points;
  const value=(n:number|null)=>n===null?'Not recorded':`${new Intl.NumberFormat('en-IN',{maximumFractionDigits:2}).format(n)}${chart.unit==='percent'?'%':''}`;
  return <section className={`agent-chart${compact?' agent-chart--compact':''}`} aria-label={chart.title}>
    <h3>{chart.title}</h3><p className="agent-chart__scope">{chart.scope} · {shortDate(chart.from)}–{shortDate(chart.to)} {chart.to.slice(0,4)}</p>
    {chart.kind==='line'?<AttendanceTrend compact attendance={{trend:chart.points.filter(p=>p.date&&p.end).map(p=>({date:p.date!,end:p.end!,percentage:p.value}))}} monthly={chart.interval==='monthly'}/>
      :chart.kind==='donut'?<DonutChart label={chart.title} unit={chart.unit} slices={chart.points.map((p,i)=>({id:String(i),label:p.label,value:p.value??0,tone:tones[i%tones.length]!}))}/>
        :<ComparisonBars label={chart.title} rows={points.map((p,i)=>({id:String(i),name:p.label,value:p.value,detail:compact?'':p.detail}))} unit={chart.unit==='percent'?'percent':'count'}/>}
    {points.length<chart.total?<p className="agent-caption">Showing {points.length} of {chart.total}. {compact?'Expand chat to explore.':'Open the source for the full comparison.'}</p>:null}
    {compact&&chart.note.startsWith('Subject attendance')?<p className="agent-caption">Projected from daily attendance</p>:null}
    {!compact?<><p className="agent-caption">{chart.note}</p><details className="agent-sources"><summary>Chart data</summary><div className="analytics-table-wrap"><table><caption>{chart.title} · {chart.unit}</caption><thead><tr><th scope="col">Label</th><th scope="col">Value</th><th scope="col">Basis</th></tr></thead><tbody>{chart.points.map((p,i)=><tr key={i}><th scope="row">{p.label}</th><td>{value(p.value)}</td><td>{p.detail}</td></tr>)}</tbody></table></div></details></>:null}
  </section>;
}
