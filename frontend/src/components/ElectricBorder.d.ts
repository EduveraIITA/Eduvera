import type { CSSProperties, ReactNode } from 'react';
export interface ElectricBorderProps {
  children?: ReactNode;
  color?: string; glowColor?: string; speed?: number; chaos?: number;
  spread?: number; thickness?: number; strands?: number; glow?: number;
  intensity?: number; arcs?: number; flicker?: number; borderRadius?: number;
  offset?: number; active?: boolean; intro?: boolean; interactive?: boolean;
  cursorRadius?: number; theme?: 'dark' | 'light'; className?: string;
  style?: CSSProperties;
}
export default function ElectricBorder(props: ElectricBorderProps): ReactNode;
