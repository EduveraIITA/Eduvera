import type { ReactNode } from 'react';

export type CampusIllustrationPart = 'people' | 'groups' | 'places' | 'schedule' | 'resources' | 'campus';

const artwork: Record<CampusIllustrationPart, ReactNode> = {
  people: <>
<g className="connected-campus-graphic__person connected-campus-graphic__person--back">
          <path className="connected-campus-graphic__gold-fill" d="M1 25V11a12 12 0 0 1 24 0v14Z" />
          <circle className="connected-campus-graphic__gold-fill" cx="13" cy="-14" r="10" />
          <path className="connected-campus-graphic__gold-stroke" d="M4-18q9-12 18 0M3 25h23" />
        </g>
        <g className="connected-campus-graphic__person connected-campus-graphic__person--front">
          <path className="connected-campus-graphic__green-fill" d="M-27 27V12a15 15 0 0 1 30 0v15Z" />
          <circle className="connected-campus-graphic__green-fill" cx="-12" cy="-18" r="12" />
          <path className="connected-campus-graphic__green-stroke" d="M-23-22q11-13 22 0M-28 27H4" />
          <path className="connected-campus-graphic__detail" d="M-17 9v9m10-9v9" />
        </g>
  </>,
  groups: <>
<g className="connected-campus-graphic__group-links">
          <path className="connected-campus-graphic__lilac-stroke" d="m-20 15 20-34 20 34Z" fill="none" />
        </g>
        <g className="connected-campus-graphic__member connected-campus-graphic__member--one">
          <circle className="connected-campus-graphic__lilac-fill" cy="-24" r="10" />
          <path className="connected-campus-graphic__lilac-fill" d="M-12-5a12 12 0 0 1 24 0v4h-24Z" />
        </g>
        <g className="connected-campus-graphic__member connected-campus-graphic__member--two">
          <circle className="connected-campus-graphic__green-fill" cx="-23" cy="6" r="9" />
          <path className="connected-campus-graphic__green-fill" d="M-35 26a12 12 0 0 1 24 0v3h-24Z" />
        </g>
        <g className="connected-campus-graphic__member connected-campus-graphic__member--three">
          <circle className="connected-campus-graphic__gold-fill" cx="23" cy="6" r="9" />
          <path className="connected-campus-graphic__gold-fill" d="M11 26a12 12 0 0 1 24 0v3H11Z" />
        </g>
  </>,
  places: <>
<path className="connected-campus-graphic__green-fill" d="m-34 8 22-7 25 8 21-7v25l-21 7-25-8-22 7Z" />
        <path className="connected-campus-graphic__green-stroke" d="M-12 1v25m25-17v25" fill="none" />
        <g className="connected-campus-graphic__pin">
          <path className="connected-campus-graphic__gold-fill connected-campus-graphic__gold-stroke" d="M0 17s-17-19-17-32a17 17 0 0 1 34 0C17-2 0 17 0 17Z" />
          <circle className="connected-campus-graphic__pin-hole" cy="-15" r="6" />
        </g>
  </>,
  schedule: <>
<g className="connected-campus-graphic__calendar">
          <rect className="connected-campus-graphic__paper" x="-27" y="-27" width="54" height="55" rx="9" />
          <path className="connected-campus-graphic__green-fill" d="M-27-18a9 9 0 0 1 9-9h36a9 9 0 0 1 9 9v7h-54Z" />
          <path className="connected-campus-graphic__green-stroke" d="M-14-32v11m28-11v11" />
          <g className="connected-campus-graphic__date-dots">
            <circle cx="-15" cy="-1" r="2.5" /><circle cx="-3" cy="-1" r="2.5" /><circle cx="9" cy="-1" r="2.5" />
            <circle cx="-15" cy="11" r="2.5" /><circle cx="-3" cy="11" r="2.5" />
          </g>
          <g className="connected-campus-graphic__date">
            <rect className="connected-campus-graphic__gold-fill" x="4" y="6" width="17" height="16" rx="5" />
            <path className="connected-campus-graphic__gold-stroke" d="m8 14 3 3 6-7" fill="none" />
          </g>
        </g>
  </>,
  resources: <>
<g className="connected-campus-graphic__books">
          <rect className="connected-campus-graphic__lilac-fill" x="-32" y="-15" width="13" height="40" rx="3" />
          <path className="connected-campus-graphic__lilac-stroke" d="M-28-6h5m-5 22h5" />
          <rect className="connected-campus-graphic__gold-fill" x="-16" y="-22" width="12" height="47" rx="3" />
          <path className="connected-campus-graphic__gold-stroke" d="M-12-12h4m-4 28h4" />
        </g>
        <g className="connected-campus-graphic__laptop">
          <rect className="connected-campus-graphic__green-fill connected-campus-graphic__green-stroke" x="0" y="-17" width="33" height="29" rx="4" />
          <path className="connected-campus-graphic__paper" d="M0 12h33l6 11H-6Z" />
          <path className="connected-campus-graphic__green-stroke" d="M10 18h13" />
          <path className="connected-campus-graphic__screen-glint" d="m7-7 8-4m3 14 8-4" />
        </g>
  </>,
  campus: <>
<path className="connected-campus-graphic__gold-fill" d="M-36-10h72v42h-72Z" />
        <path className="connected-campus-graphic__green-fill connected-campus-graphic__green-stroke" d="M-45-10 0-37 45-10Z" />
        <path className="connected-campus-graphic__gold-stroke" d="M-36-10v42h72v-42M-43 33h86" fill="none" />
        <path className="connected-campus-graphic__door" d="M-7 32V16a7 7 0 0 1 14 0v16Z" />
        <path className="connected-campus-graphic__windows" d="M-26 0h8v8h-8Zm44 0h8v8h-8ZM-26 17h8v8h-8Zm44 0h8v8h-8Z" />
        <circle className="connected-campus-graphic__clock-face" cy="-18" r="6" />
        <path className="connected-campus-graphic__green-stroke" d="M0-22v4l3 2" fill="none" />
        <g className="connected-campus-graphic__sprout">
          <path className="connected-campus-graphic__green-stroke" d="M50 33V13" />
          <path className="connected-campus-graphic__green-fill" d="M50 22q-15-2-11-14 12 1 11 14M50 17q-1-16 11-17 5 13-11 17" />
        </g>
  </>,
};

export function CampusIllustration({ part }: { part: CampusIllustrationPart }) {
  return <svg className="connected-campus-graphic__art" viewBox={part === 'campus' ? '-50 -42 116 84' : '-40 -40 80 80'} aria-hidden="true" focusable="false">{artwork[part]}</svg>;
}
