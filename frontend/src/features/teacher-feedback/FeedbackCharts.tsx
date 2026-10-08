import { useId } from 'react';
import type { Summary } from './api';
import { percent, ratingNames, feedbackOverview } from './feedback-analytics';

export function RatingMix({ parameters, minimum = 5 }: { minimum?: number; parameters: Summary['parameters'] }) {
  const { counts, rated, visible } = feedbackOverview(parameters);
  const id = useId();
  if (!rated) return <section className="feedback-panel"><h4>Rating mix</h4><p>Charts will appear when a parameter has at least {minimum} Low, Okay or High ratings.</p></section>;
  let offset = 0;
  const slices = (['high', 'okay', 'low'] as const).map(key => {
    const length = counts[key] / rated * 100, start = offset; offset += length;
    return { key, length, start };
  });
  return <section className="feedback-panel"><h4 id={id}>Rating mix</h4>
    <div className="feedback-mix">
      <svg viewBox="0 0 160 160" role="img" aria-label={`${percent(counts.high, rated)}% of ${rated} rated ${rated === 1 ? 'answer is' : 'answers are'} High`} className="feedback-ring">
        <circle cx="80" cy="80" r="62" className="feedback-ring__track" />
        {slices.filter(s => s.length > 0).map(s => <circle key={s.key} cx="80" cy="80" r="62" pathLength="100" className={`feedback-ring__slice feedback-tone--${s.key}`} strokeDasharray={`${s.length} ${100 - s.length}`} strokeDashoffset={-s.start} transform="rotate(-90 80 80)" />)}
        <text x="80" y="77" textAnchor="middle" className="feedback-ring__value">{percent(counts.high, rated)}%</text>
        <text x="80" y="99" textAnchor="middle" className="feedback-ring__label">rated High</text>
      </svg>
      <ul className="feedback-legend" aria-labelledby={id}>{slices.map(s => <li key={s.key}><span><i className={`feedback-swatch feedback-tone--${s.key}`} />{ratingNames[s.key]}</span><strong>{counts[s.key]} <small>({percent(counts[s.key], rated)}%)</small></strong></li>)}</ul>
    </div>
    <p>{rated} rated {rated === 1 ? 'answer' : 'answers'} across {visible} {visible === 1 ? 'parameter' : 'parameters'}, not individual people. {counts.na} Not sure answers excluded. Hidden parameters are excluded.</p>
  </section>;
}

type PlotPoint = { label: string; value: number; time: number };
function LinePlot({ points, maximum, label, suffix = '' }: { points: PlotPoint[]; maximum: number; label: string; suffix?: string }) {
  const start = points[0]?.time ?? 0, duration = (points.at(-1)?.time ?? start) - start;
  const x = (index: number) => duration > 0 ? 38 + (points[index]!.time - start) / duration * 272 : 174;
  const y = (value: number) => 132 - value / Math.max(1, maximum) * 108;
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p.value)}`).join(' ');
  return <svg viewBox="0 0 344 174" role="img" aria-label={label} className="feedback-lineplot">
    {[0, maximum / 2, maximum].map((tick, index) => <g key={index}><line x1="38" x2="310" y1={y(tick)} y2={y(tick)} className="feedback-gridline" /><text x="30" y={y(tick) + 4} textAnchor="end">{Number(tick.toFixed(1))}{suffix}</text></g>)}
    {points.length > 1 ? <path d={path} pathLength="1" className="feedback-lineplot__line" /> : null}
    {points.map((p, i) => <g key={`${p.label}-${i}`}><circle cx={x(i)} cy={y(p.value)} r="4" className="feedback-lineplot__point"><title>{p.label}: {p.value}{suffix}</title></circle>
      {i === 0 || i === points.length - 1 ? <text x={x(i)} y="160" textAnchor={i === 0 ? 'start' : 'end'}>{p.label}</text> : null}</g>)}
  </svg>;
}
const shortDate = (date: string) => new Date(date.length === 10 ? date + 'T12:00:00Z' : date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
export function ResponseActivity({ activity }: { activity: NonNullable<Summary['activity']> }) {
  const points = activity.map((day, index) => ({ label: shortDate(day.date), time: new Date(day.date + 'T12:00:00Z').getTime(), value: activity.slice(0, index + 1).reduce((total, item) => total + item.count, 0) }));
  const running = points.at(-1)?.value ?? 0;
  return <section className="feedback-panel"><h4>Response activity</h4><p>Cumulative responses · dates in the school’s time zone</p>
    {!points.length ? <p className="feedback-empty">No responses yet. The chart will appear after the first submission.</p> : <><LinePlot points={points} maximum={Math.max(2, Math.ceil(running / 2) * 2)} label={`${running} responses collected across ${points.length} active days`} />
      <details><summary>View response counts</summary><div className="feedback-table-wrap"><table><caption>Response activity, on days with submissions</caption><thead><tr><th scope="col">Date</th><th scope="col">New</th><th scope="col">Total</th></tr></thead><tbody>{activity.map((day, i) => <tr key={day.date}><th scope="row">{day.date}</th><td>{day.count}</td><td>{points[i]!.value}</td></tr>)}</tbody></table></div></details></>}
  </section>;
}
export function FeedbackHistory({ history, minimum = 5 }: { minimum?: number; history: NonNullable<Summary['history']> }) {
  const first = history.at(-2), last = history.at(-1);
  const delta = first && last ? Math.round((last.high_percent - first.high_percent) * 10) / 10 : null;
  return <section className="feedback-panel"><div className="feedback-panel__heading"><h4>Across feedback rounds</h4>{delta !== null ? <span className="feedback-delta">{delta > 0 ? '+' : ''}{delta} pp</span> : null}</div>
    {history.length < 2 ? <p className="feedback-empty">A trend needs two closed rounds with the same teacher, class, audience and questions, and at least {minimum} {minimum === 1 ? 'rating' : 'ratings'} on every parameter.</p> : <>
      <p>High ratings as a share of rated answers. {delta === 0 ? 'Unchanged' : delta! > 0 ? 'Up' : 'Down'} {Math.abs(delta!)} percentage points from the previous round.</p>
      <LinePlot points={history.map(r => ({ label: shortDate(r.closed_at), time: new Date(r.closed_at).getTime(), value: r.high_percent }))} maximum={100} suffix="%" label={`High ratings across ${history.length} comparable rounds; latest ${last!.high_percent}%`} />
      <details><summary>Compare round details</summary><div className="feedback-table-wrap"><table><caption>Comparable feedback rounds, by closing date (UTC)</caption><thead><tr><th scope="col">Closed</th><th scope="col">Responses</th><th scope="col">High</th></tr></thead><tbody>{history.map(r => <tr key={r.id}><th scope="row">{shortDate(r.closed_at)}</th><td>{r.response_count}</td><td>{r.high_percent}%</td></tr>)}</tbody></table></div></details>
      <p>Up to 6 recent comparable rounds. Respondents may differ; a change does not prove improvement or decline.</p>
    </>}
  </section>;
}
