import type { ReactNode } from 'react';
import ElectricBorder from '../../components/ElectricBorder';

/** Quiet blue current, shared by the compact assistant and full conversation. */
export function AssistantElectricBorder({children, borderRadius = 16}: {children: ReactNode; borderRadius?: number}) {
  return <ElectricBorder className="assistant-electric-border" color="#6366f1" glowColor="#4f46e5"
    speed={0.65} chaos={0.05} spread={0.16} strands={1} thickness={0.5}
    glow={1.05} intensity={1} arcs={0} flicker={0} interactive={false}
    borderRadius={borderRadius} theme="light">
    {children}
  </ElectricBorder>;
}
