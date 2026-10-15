import type { ReactNode } from 'react';
import ElectricBorder from '../../components/ElectricBorder';

/** Quiet blue current, shared by the compact assistant and full conversation. */
export function AssistantElectricBorder({children, borderRadius = 16}: {children: ReactNode; borderRadius?: number}) {
  return <ElectricBorder className="assistant-electric-border" color="#38bdf8" glowColor="#7dd3fc"
    speed={0.9} chaos={0.18} spread={0.12} strands={2} thickness={0.65}
    glow={0.65} intensity={1} arcs={0} flicker={0.04} interactive={false}
    borderRadius={borderRadius} theme="light">
    {children}
  </ElectricBorder>;
}
