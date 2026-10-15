import type { ReactNode } from 'react';
import ElectricBorder from '../../components/ElectricBorder';

/** Quiet blue current, shared by the compact assistant and full conversation. */
export function AssistantElectricBorder({children, borderRadius = 16}: {children: ReactNode; borderRadius?: number}) {
  return <ElectricBorder className="assistant-electric-border" color="#3b82f6" glowColor="#78aaf2"
    speed={0.8} chaos={0.3} spread={0.22} strands={2} thickness={1.2}
    glow={0.4} intensity={0.7} arcs={0} flicker={0.08} interactive={false}
    borderRadius={borderRadius} theme="light">
    {children}
  </ElectricBorder>;
}
