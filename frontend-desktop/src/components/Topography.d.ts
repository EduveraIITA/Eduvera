import type { CSSProperties, ReactElement } from 'react';
export type TopographyDirection = 'forward' | 'backward' | 'left' | 'right';
export type TopographyHoverEffect = 'lift' | 'trace' | 'light';
export type TopographyClickEffect = 'pulse' | 'peak' | 'none';
export type TopographyMarkers = 'none' | 'plus' | 'dots';

export interface TopographyProps {
  color?: string;
  lineCount?: number;
  lineWidth?: number;
  majorLines?: boolean;
  elevation?: number;
  foreground?: number;
  scale?: number;
  detail?: number;
  tilt?: number;
  speed?: number;
  direction?: TopographyDirection;
  morph?: number;
  glow?: number;
  depthOfField?: number;
  fog?: number;
  brightness?: number;
  opacity?: number;
  mouseInteraction?: boolean;
  hoverEffect?: TopographyHoverEffect;
  mouseRadius?: number;
  mouseStrength?: number;
  trail?: number;
  parallax?: number;
  clickEffect?: TopographyClickEffect;
  markers?: TopographyMarkers;
  glitch?: number;
  intro?: boolean;
  lightMode?: boolean;
  dpr?: number;
  className?: string;
  style?: CSSProperties;
}


declare function Topography(props: TopographyProps): ReactElement;
export default Topography;
