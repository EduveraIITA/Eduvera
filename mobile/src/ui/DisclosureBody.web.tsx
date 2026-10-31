import type { PropsWithChildren } from 'react';
import { useReducedMotion } from './Motion';

/** Intrinsic-height reveal keeps editors mounted and closed controls unfocusable. */
export function DisclosureBody({ open, children }: PropsWithChildren<{ open: boolean }>) {
  const reduced = useReducedMotion();
  return <div aria-hidden={!open} inert={!open} style={{ display: 'grid', gridTemplateRows: open ? '1fr' : '0fr', opacity: open ? 1 : 0, transition: reduced ? 'none' : 'grid-template-rows 180ms ease-out, opacity 140ms ease-out' }}><div style={{ overflow: 'hidden', minHeight: 0 }}><div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{children}</div></div></div>;
}
