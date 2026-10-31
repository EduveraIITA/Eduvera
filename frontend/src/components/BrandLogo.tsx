import type { CSSProperties } from 'react';
import './brand-logo.css';

/** Supplied transparent artwork, selected by the app's resolved appearance. */
export function BrandLogo({className='',width=98,height=64,alt='ThatCampus'}:{className?:string;width?:number;height?:number;alt?:string}) {
  return <span
    className={`thatcampus-logo ${className}`.trim()}
    role={alt ? 'img' : undefined}
    aria-label={alt || undefined}
    aria-hidden={alt ? undefined : true}
    style={{'--brand-logo-width':`${width}px`,'--brand-logo-height':`${height}px`} as CSSProperties}
  >
    <img className="thatcampus-logo__artwork thatcampus-logo__artwork--light" src="/assets/thatcampus-wordmark-light-v3.png" alt="" aria-hidden="true" width={width} height={height}/>
    <img className="thatcampus-logo__artwork thatcampus-logo__artwork--dark" src="/assets/thatcampus-wordmark-dark-v3.png" alt="" aria-hidden="true" width={width} height={height}/>
  </span>;
}
