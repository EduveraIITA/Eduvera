import { useRef, type PointerEvent } from 'react';
import type { Rating } from './api';

export const ratingLabels: Record<Rating, string> = { low: 'Low', okay: 'Okay', high: 'High', na: 'Not sure' };
const options = Object.keys(ratingLabels) as Rating[];

export function RatingSelector({ name, value, disabled, onChange }: {
  name: string;
  value?: Rating;
  disabled: boolean;
  onChange: (value: Rating | undefined) => void;
}) {
  const gesture = useRef<{ id: number; x: number; y: number; original?: Rating; dragging: boolean } | null>(null);
  const suppressClick = useRef(false);
  function ratingAt(event: PointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const index = Math.floor((event.clientX - bounds.left - 4) / ((bounds.width - 8) / options.length));
    return options[Math.max(0, Math.min(options.length - 1, index))];
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    const active = gesture.current;
    if (!active || active.id !== event.pointerId || disabled) return;
    const dx = Math.abs(event.clientX - active.x);
    const dy = Math.abs(event.clientY - active.y);
    if (!active.dragging) {
      if (dy > 8 && dy > dx) { gesture.current = null; return; }
      if (dx < 8 || dx <= dy) return;
      active.dragging = true;
      suppressClick.current = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    onChange(ratingAt(event));
  }
  return <div className="teacher-feedback__ratings" data-selected={value}
    onPointerDown={event => {
      if (disabled || !event.isPrimary || event.button !== 0) return;
      suppressClick.current = false;
      gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, original: value, dragging: false };
    }}
    onPointerMove={move}
    onPointerUp={event => {
      const active = gesture.current;
      if (!active || active.id !== event.pointerId) return;
      if (active.dragging && !disabled) {
        const next = ratingAt(event);
        onChange(next);
        event.currentTarget.querySelector<HTMLInputElement>(`input[value="${next}"]`)?.focus({ preventScroll: true });
      }
      gesture.current = null;
      if (active.dragging && event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    }}
    onPointerCancel={event => {
      if (gesture.current?.id !== event.pointerId) return;
      if (gesture.current.dragging) onChange(gesture.current.original);
      gesture.current = null;
    }}
    onLostPointerCapture={event => { if (event.target === event.currentTarget) gesture.current = null; }}
    onClickCapture={event => {
      if (suppressClick.current && event.detail > 0) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false; }
    }}>
    {options.map(rating => <label key={rating} className={`teacher-feedback__rating${value === rating ? ' is-selected' : ''}`}>
      <input type="radio" name={name} value={rating} checked={value === rating} required disabled={disabled} onChange={() => onChange(rating)} />
      <span>{ratingLabels[rating]}</span>
    </label>)}
  </div>;
}
