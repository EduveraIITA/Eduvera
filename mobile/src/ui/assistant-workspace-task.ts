import { useSyncExternalStore, type ReactNode } from 'react';

export const CAMPUS_ASSISTANT_TASK_HREF = '/areas/assistant/conversation?workspace_task=campus';

type WorkspaceTask = {
  owner: symbol;
  scopeKey: string;
  title: string;
  content: ReactNode;
  onReturn: () => void;
};

let current: WorkspaceTask | null = null;
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

export function showAssistantWorkspaceTask(task: WorkspaceTask) {
  current = task;
  listeners.forEach(listener => listener());
}

export function clearAssistantWorkspaceTask(owner: symbol) {
  if (current?.owner !== owner) return;
  current = null;
  listeners.forEach(listener => listener());
}

export function useAssistantWorkspaceTask(scopeKey: string) {
  const task = useSyncExternalStore(subscribe, () => current, () => null);
  return task?.scopeKey === scopeKey ? task : null;
}
