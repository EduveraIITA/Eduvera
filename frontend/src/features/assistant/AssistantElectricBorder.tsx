import type { ReactNode } from 'react';
import ElectricBorder from '../../components/ElectricBorder';

/** Quiet blue current, shared by the compact assistant and full conversation. */
export function AssistantElectricBorder({children, borderRadius = 16}: {children: ReactNode; borderRadius?: number}) {
  return <ElectricBorder className="assistant-electric-border" color="#78aaf2" glowColor="#93baff"
    speed={0.3} chaos={0.08} spread={0.06} strands={1} thickness={0.65}
    glow={0.12} intensity={0.24} arcs={0} flicker={0} interactive={false}
    borderRadius={borderRadius} theme="light">
    {children}
  </ElectricBorder>;
}
