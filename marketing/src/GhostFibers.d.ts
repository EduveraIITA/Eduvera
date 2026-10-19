import type { ComponentType } from 'react';
type GhostFibersProps = {
  glowColor?: string; lineColor?: string; secondaryColor?: string;
  speed?: number; scale?: number; rotation?: number; rollSpeed?: number;
  layers?: number; threads?: number; density?: number; fiberStyle?: 'dots' | 'dashes' | 'lines';
  glow?: number; brightness?: number; particles?: number; sparkle?: number;
  grain?: number; vignette?: number; mouseInteraction?: boolean; pulseOnClick?: boolean;
  intro?: boolean; lightMode?: boolean; paused?: boolean; dpr?: number;
};
declare const GhostFibers: ComponentType<GhostFibersProps>;
export default GhostFibers;
