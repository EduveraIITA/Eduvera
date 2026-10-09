import { createContext, useContext, useState, type ReactNode } from "react";
import { useOptionalAuth } from "../auth/AuthContext";
import type { AssistantContext, DemoReply } from "./demoReplies";
export interface DemoTurn { id: string; question: string; reply: DemoReply }
type Threads = Record<string, DemoTurn[]>;
const Session = createContext<{ threads: Threads; append: (key: string, turn: DemoTurn) => void; clear: (key: string) => void } | null>(null);
function Memory({ children }: { children: ReactNode }) {
  const [threads, setThreads] = useState<Threads>({});
  return <Session.Provider value={{ threads,
    append: (key, turn) => setThreads(previous => ({ ...previous, [key]: [...(previous[key] ?? []), turn] })),
    clear: key => setThreads(previous => ({ ...previous, [key]: [] })),
  }}>{children}</Session.Provider>;
}
export function AssistantSessionProvider({ children }: { children: ReactNode }) {
  const auth = useOptionalAuth();
  // In-memory only. Logout, account/school changes and reload discard this demo.
  return <Memory key={`${auth?.user?.id ?? "signed-out"}:${auth?.user?.active_school_id ?? ""}`}>{children}</Memory>;
}
export function useDemoConversation(context: AssistantContext) {
  const session = useContext(Session);
  const [localTurns, setLocalTurns] = useState<DemoTurn[]>([]);
  const key = `${context.portal}:${context.studentId ?? "self"}`;
  return {
    turns: session?.threads[key] ?? (session ? [] : localTurns),
    append: (question: string, reply: DemoReply) => {
      const turn = { id: crypto.randomUUID(), question, reply };
      if (session) session.append(key, turn); else setLocalTurns(previous => [...previous, turn]);
    },
    clear: () => { if (session) session.clear(key); else setLocalTurns([]); },
  };
}
