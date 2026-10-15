import type { ReactNode } from 'react';
import ElectricBorder from '../../components/ElectricBorder';

/** Quiet blue current, shared by the compact assistant and full conversation. */
export function AssistantElectricBorder({children, borderRadius = 16}: {children: ReactNode; borderRadius?: number}) {
  return <ElectricBorder className="assistant-electric-border" color="#4d8de8" glowColor="#78aaf2"
    speed={0.3} chaos={0.08} spread={0.06} strands={1} thickness={1}
    glow={0.28} intensity={0.5} arcs={0} flicker={0} interactive={false}
    borderRadius={borderRadius} theme="light">
    {children}
  </ElectricBorder>;
}
