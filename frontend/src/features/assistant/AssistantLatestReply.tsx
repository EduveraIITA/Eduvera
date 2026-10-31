import type { ReactNode } from 'react';
import { AssistantElectricBorder } from './AssistantElectricBorder';
import { AssistantIcon } from './AssistantIcon';

/** The existing animated mark belongs only to the newest full-screen reply. */
export function AssistantLatestReply({children}: {children: ReactNode}) {
  return <div className="assistant-latest-reply">
    <div className="assistant-latest-reply__mark" aria-hidden="true"><AssistantIcon size={26}/></div>
    <AssistantElectricBorder>{children}</AssistantElectricBorder>
  </div>;
}
