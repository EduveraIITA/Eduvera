import { useId } from 'react';
import './AssistantIcon.css';

/** ThatCampus assistant mark: three rounded rays and a blue core. */
export function AssistantIcon({size=24}:{size?:number}) {
  const gradient=useId();
  return <svg className="assistant-brand-icon" width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true" focusable="false">
    <defs><linearGradient id={gradient} x1="48" y1="4" x2="17" y2="61" gradientUnits="userSpaceOnUse"><stop stopColor="#00a7f5"/><stop offset="1" stopColor="#0751f9"/></linearGradient></defs>
    <g fill={`url(#${gradient})`}>
      <path d="M25.4 10.8C24.7 6.4 27.8 3 32 3s7.3 3.4 6.6 7.8l-3.2 18c-.7 3.9-6.1 3.9-6.8 0z"/>
      <path d="M4.4 30.8c-3.8-2.6-4-7.5-.9-10.5 3-3 7.6-2.5 10.3 1.1l9.3 12.4c2.4 3.3-.8 7-4.3 4.8z"/>
      <path d="M59.6 30.8c3.8-2.6 4-7.5.9-10.5-3-3-7.6-2.5-10.3 1.1l-9.3 12.4c-2.4 3.3.8 7 4.3 4.8z"/>
      <circle cx="32" cy="49" r="10"/>
    </g>
  </svg>;
}
