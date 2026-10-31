import type { ReactNode } from 'react';

/** Theme-blue flowing edge, shared by the compact assistant and full conversation. */
export function AssistantElectricBorder({children}: {children: ReactNode}) {
  return <div className="assistant-electric-border">
    {children}
  </div>;
}
