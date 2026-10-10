import { History, SquarePen } from 'lucide-react';
import type { ThreadSummary } from './agentApi';

interface AssistantHeaderActionsProps {
  threads: readonly ThreadSummary[];
  currentThreadId?: string;
  disabled?: boolean;
  onNewChat: () => void;
  onSelect: (threadId: string) => void;
}

export function AssistantHeaderActions({threads,currentThreadId,disabled=false,onNewChat,onSelect}:AssistantHeaderActionsProps) {
  return <div className="assistant-header-actions" role="group" aria-label="Chat controls">
    {threads.length>1?<details className="assistant-header-history">
      <summary role="button" aria-label="Open conversations" title="Conversations">
        <History size={19} strokeWidth={2} aria-hidden="true"/>
      </summary>
      <div className="assistant-header-history__menu">
        <strong>Conversations</strong>
        <ul>
          {threads.map(thread=><li key={thread.id}>
            <button type="button" aria-current={thread.id===currentThreadId?'true':undefined} disabled={disabled} onClick={event=>{
              event.currentTarget.closest('details')?.removeAttribute('open');
              onSelect(thread.id);
            }}>{thread.title}</button>
          </li>)}
        </ul>
      </div>
    </details>:null}
    <button className="assistant-header-actions__new" type="button" aria-label="Start a new chat" title="New chat" disabled={disabled} onClick={onNewChat}>
      <SquarePen size={19} strokeWidth={2} aria-hidden="true"/>
    </button>
  </div>;
}
