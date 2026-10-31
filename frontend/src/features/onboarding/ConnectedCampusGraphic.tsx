import { CampusIllustration, type CampusIllustrationPart } from './CampusIllustration';
import './connected-campus-graphic.css';

const satellites: { part: CampusIllustrationPart; label: string; x: number; y: number }[] = [
  { part: 'people', label: 'People', x: 0, y: -72 },
  { part: 'groups', label: 'Groups', x: 68.48, y: -22.25 },
  { part: 'places', label: 'Places', x: 42.32, y: 58.25 },
  { part: 'schedule', label: 'Schedules', x: -42.32, y: 58.25 },
  { part: 'resources', label: 'Resources', x: -68.48, y: -22.25 },
];

/** Decorative campus connections, not live data. Only illustrations sway. */
export function ConnectedCampusGraphic() {
  return <div className="campus-start__foundation connected-campus-graphic" aria-label="Shared campus foundation">
    <svg className="connected-campus-graphic__connections" viewBox="0 0 232 200" aria-hidden="true" focusable="false">
      {satellites.map(({ part, x, y }) => <line key={part}
        x1={116 + x * .5} y1={100 + y * .5}
        x2={116 + x * .78} y2={100 + y * .78} />)}
    </svg>
    <div className="connected-campus-graphic__nodes">
      {satellites.map(({ part, label, x, y }) => <div key={part} className={`connected-campus-graphic__satellite connected-campus-graphic__satellite--${part}`} style={{ left: `calc(50% + ${x}px)`, top: `calc(50% + ${y}px)` }}>
        <div className="connected-campus-graphic__satellite-content">
          <CampusIllustration part={part} />
          <span>{label}</span>
        </div>
      </div>)}
    </div>
    <div className="connected-campus-graphic__center">
      <CampusIllustration part="campus" />
      <span>Campus</span>
    </div>
  </div>;
}
