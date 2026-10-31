import assistantIcon from './thatcampus-agent-no-glow.svg';
import assistantIconDark from './thatcampus-agent-no-glow-dark.svg';
import './AssistantIcon.css';

/** Preserve the supplied animated artwork and existing navigation dimensions. */
export function AssistantIcon({size=24}:{size?:number}) {
  return <span className="assistant-brand-icon" style={{ width: size, height: size }} aria-hidden="true">
    <picture className="assistant-brand-icon__light">
      <source media="(prefers-reduced-motion: reduce)" srcSet="/assets/thatcampus-brand-mark.svg" />
      <img src={assistantIcon} width={size} height={size} alt="" aria-hidden="true" draggable={false}/>
    </picture>
    <picture className="assistant-brand-icon__dark">
      <source media="(prefers-reduced-motion: reduce)" srcSet="/assets/thatcampus-brand-mark-dark.svg" />
      <img src={assistantIconDark} width={size} height={size} alt="" aria-hidden="true" draggable={false}/>
    </picture>
  </span>;
}
