export interface UpdateJournalProgress<Accepted> { accepted?: Accepted; cleared: boolean; dispatched: boolean }
type Journal<Command> = { write(value: string): Promise<void>; clear(): Promise<void>; retain(value: Command | null): void };

/** Clearing accepted/definitely refused intent is durable bookkeeping. Once the
 * clear resolves, forget it before checking visibility so a stale callback cannot
 * resurrect an action which no longer exists on disk. Never dispatch here. */
export async function clearUpdateJournal<Command, Accepted>(journal: Journal<Command>, assertCurrent: () => void, progress: UpdateJournalProgress<Accepted>) {
  assertCurrent();
  await journal.clear();
  journal.retain(null); progress.cleared = true;
  assertCurrent();
}

/** A callable retry keeps the original request across every storage/network gap.
 * The same focused href/source/transport guard is required on both sides of I/O. */
export async function executeUpdateJournal<Command extends { accepted?: Accepted }, Accepted>(command: Command, options: {
  capture(): () => void; journal: Journal<Command>; progress: UpdateJournalProgress<Accepted>;
  send(command: Command): Promise<unknown>; receipt(value: unknown): Accepted;
}): Promise<Accepted> {
  const assertCurrent = options.capture(), { journal, progress } = options;
  assertCurrent();
  if (!progress.accepted) {
    // Retain before the first asynchronous storage boundary, including a failed
    // write. Another retained screen cannot replace this exact preparation.
    journal.retain(command);
    assertCurrent(); await journal.write(JSON.stringify(command)); assertCurrent();
    progress.dispatched = true;
    const result = await options.send(command); assertCurrent();
    progress.accepted = options.receipt(result);
    const saved = { ...command, accepted: progress.accepted };
    journal.retain(saved);
    assertCurrent(); await journal.write(JSON.stringify(saved)); assertCurrent();
  }
  await clearUpdateJournal(journal, assertCurrent, progress);
  return progress.accepted!;
}
