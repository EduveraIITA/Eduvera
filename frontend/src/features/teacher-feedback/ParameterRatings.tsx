import { useId, useState } from 'react';
import type { CSSProperties } from 'react';
import type { Summary } from './api';
import { percent, ratingNames, signalNames } from './feedback-analytics';
export function ParameterRatings({ parameters, minimum = 5 }: { minimum?: number; parameters: Summary['parameters'] }) {
  const [order, setOrder] = useState('original');
  const id = useId();
  const sorted = [...parameters];
  if (order !== 'original') sorted.sort((a, b) => {
    if (!a.counts) return b.counts ? 1 : 0;
    if (!b.counts) return -1;
    const key = order === 'support' ? 'low' : 'high';
    return b.counts[key] / b.rated - a.counts[key] / a.rated;
  });
  return <section className="feedback-panel feedback-parameters"><div className="feedback-panel__heading"><h4>By parameter</h4><div className="feedback-sort"><label htmlFor={id}>Sort</label><select id={id} value={order} onChange={e => setOrder(e.target.value)}><option value="original">Question order</option><option value="support">Most Low first</option><option value="strengths">Most High first</option></select></div></div>
    <p>Tap a parameter for exact counts. Bars exclude Not sure.</p>
    <div className="feedback-inline-legend">{(['high', 'okay', 'low'] as const).map(key => <span key={key}><i className={`feedback-swatch feedback-tone--${key}`} />{ratingNames[key]}</span>)}</div>
    {sorted.map(p => <details className="feedback-parameter" key={p.parameter}><summary><span className="feedback-parameter__heading"><strong>{p.parameter}</strong><span className={`teacher-feedback__signal teacher-feedback__signal--${p.signal}`}>{signalNames[p.signal]}</span></span>
      {p.counts ? <><span className="feedback-stacked" aria-label={`${p.parameter}: ${percent(p.counts.high, p.rated)}% High, ${percent(p.counts.okay, p.rated)}% Okay, ${percent(p.counts.low, p.rated)}% Low`}>
        {(['high', 'okay', 'low'] as const).filter(key => p.counts![key] > 0).map(key => <span key={key} className={`feedback-tone--${key}`} style={{ '--share': `${p.counts![key] / p.rated * 100}%` } as CSSProperties}>{percent(p.counts![key], p.rated) >= 15 ? `${percent(p.counts![key], p.rated)}%` : ''}</span>)}
      </span><span className="feedback-parameter__meta">{p.rated} rated · {p.counts.na} Not sure <span>Details</span></span></> : <span className="feedback-parameter__meta">{minimum === 1 ? 'No rated answers yet' : `Fewer than ${minimum} ratings`} · distribution hidden</span>}
    </summary>
      {p.counts ? <dl className="feedback-rating-counts">{(['high', 'okay', 'low', 'na'] as const).map(key => <div key={key}><dt>{ratingNames[key]}</dt><dd>{p.counts![key]}</dd></div>)}</dl> : <p>Not sure does not count towards the {minimum}-rating minimum. This parameter is excluded from the rating mix and insights.</p>}
    </details>)}
  </section>;
}
