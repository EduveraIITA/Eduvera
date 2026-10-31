import { useEffect, useRef, useState } from 'react';
import type { useNativePendingAction } from '../../lib/native-pending-action';
import { completePeopleEditor } from '../../lib/people-editor-policy';
import { useOperationContext } from '../../lib/use-operation-context';
import { Alert } from '../../ui/Alert';
import { useScreenExitGuard } from '../../ui/BackNavigation';

type Writer = ReturnType<typeof useNativePendingAction<unknown>>;

/** The shared navigation provider aggregates all mounted editor guards into
 * one losing-exit prompt. Accepted closes wait until the clean guard commits. */
export function usePeopleEditorGuard({ dirty, busy, source, onError }: { dirty: boolean; busy: boolean; source: string; onError(message: string): void }) {
  const capture = useOperationContext(source);
  const [completion, setCompletion] = useState<{ assertCurrent(): void; run(): void | Promise<void> } | null>(null);
  const error = useRef(onError); error.current = onError;
  useScreenExitGuard({ blocked: busy, dirty: dirty && !completion });
  useEffect(() => {
    if (!completion) return;
    void completePeopleEditor(completion).catch(cause => { setCompletion(null); error.current(cause instanceof Error ? cause.message : 'Return to this original editor to continue.'); });
  }, [completion]);
  const complete = (run: () => void | Promise<void>) => {
    try { setCompletion({ assertCurrent: capture(), run }); }
    catch (cause) { error.current(cause instanceof Error ? cause.message : 'Return to this original editor to continue.'); }
  };
  const leave = (run: () => void | Promise<void>) => {
    if (busy) return;
    try {
      const assertCurrent = capture();
      if (!dirty || completion) { assertCurrent(); complete(run); return; }
      Alert.alert('Discard unsaved People changes?', 'These unsaved details will be lost. A securely retained sent action remains available for recovery.', [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Discard and leave', style: 'destructive', onPress: () => { try { assertCurrent(); complete(run); } catch {} } },
      ]);
    } catch (cause) { error.current(cause instanceof Error ? cause.message : 'Return to this original editor to continue.'); }
  };
  return { complete, leave };
}

/** Older confirmation callbacks also consult the newest failed-read state. */
export function usePeopleSourceWriter(writer: Writer, paused: boolean): Writer {
  const latest = useRef({ writer, paused }); latest.current = { writer, paused };
  return { ...writer, locked: writer.locked || paused,
    run: input => latest.current.paused ? Promise.resolve(false) : latest.current.writer.run(input),
    recover: () => latest.current.paused ? Promise.resolve(false) : latest.current.writer.recover(),
  };
}
