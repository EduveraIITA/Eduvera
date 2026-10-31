import { useState } from "react";
import type { CampusSceneDocument } from "./types";

interface History { past: CampusSceneDocument[]; present: CampusSceneDocument; future: CampusSceneDocument[] }

/** Keep corrections reversible in memory; drafts are persisted only by Save. */
export function useSceneHistory(initial: CampusSceneDocument) {
  const [history, setHistory] = useState<History>({ past: [], present: initial, future: [] });
  const [saved, setSaved] = useState(JSON.stringify(initial));
  const change = (update: CampusSceneDocument | ((current: CampusSceneDocument) => CampusSceneDocument)) => {
    setHistory(current => {
      const next = typeof update === "function" ? update(current.present) : update;
      if (JSON.stringify(next) === JSON.stringify(current.present)) return current;
      return { past: [...current.past.slice(-49), current.present], present: next, future: [] };
    });
  };
  return {
    document: history.present, dirty: JSON.stringify(history.present) !== saved,
    canUndo: history.past.length > 0, canRedo: history.future.length > 0, change,
    undo: () => setHistory(current => {
      const previous = current.past.at(-1);
      return previous ? { past: current.past.slice(0, -1), present: previous, future: [current.present, ...current.future] } : current;
    }),
    redo: () => setHistory(current => {
      const next = current.future[0];
      return next ? { past: [...current.past, current.present], present: next, future: current.future.slice(1) } : current;
    }),
    acceptSaved: (document: CampusSceneDocument) => {
      setSaved(JSON.stringify(document));
      setHistory(current => ({ ...current, present: document }));
    },
  };
}
