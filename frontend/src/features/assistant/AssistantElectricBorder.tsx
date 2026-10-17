import type { ReactNode } from 'react';

/** Theme-blue flowing edge, shared by the compact assistant and full conversation. */
export function AssistantElectricBorder({children, borderRadius = 16}: {children: ReactNode; borderRadius?: number}) {
  return <div className="assistant-electric-border" style={{borderRadius}}>
    {children}
  </div>;
}
