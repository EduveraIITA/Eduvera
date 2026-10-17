import assistantIcon from './thatcampus-agent-no-glow.svg';
import './AssistantIcon.css';

/** Preserve the supplied animated artwork and existing navigation dimensions. */
export function AssistantIcon({size=24}:{size?:number}) {
  return <img className="assistant-brand-icon" src={assistantIcon} width={size} height={size} alt="" aria-hidden="true" draggable={false}/>;
}
