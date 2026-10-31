export type AssistantCommand =
  | { kind: 'send'; threadId: string; question: string; clientId: string; phase?: 'creating' | 'accepted' }
  | { kind: 'decision'; threadId: string; actionId: string; decision: 'confirm' | 'reject'; phase?: 'accepted' };
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const outcomes = ['executing', 'succeeded', 'rejected', 'expired', 'stale', 'failed', 'uncertain'];
export function validAssistantCommand(value: unknown): value is AssistantCommand {
  if (!value || typeof value !== 'object') return false;
  const command = value as AssistantCommand;
  return command.kind === 'send'
    ? (command.threadId === '' || uuid(command.threadId)) && uuid(command.clientId) && typeof command.question === 'string' && command.question.trim().length > 0 && command.question.length <= 4000 && (command.phase === undefined || command.phase === 'creating' && !command.threadId || command.phase === 'accepted' && !!command.threadId)
    : command.kind === 'decision' && uuid(command.threadId) && uuid(command.actionId) && ['confirm', 'reject'].includes(command.decision) && (command.phase === undefined || command.phase === 'accepted');
}
export function restoreAssistantCommand(value: unknown): AssistantCommand {
  if (!validAssistantCommand(value)) throw new Error('The retained assistant action could not be verified.');
  return value.kind === 'send' && !value.threadId ? { ...value, phase: 'creating' } : value;
}
export function assistantDefinitiveRefusal(status: unknown, progress: { dispatched: boolean; accepted: boolean; cleared: boolean }, recovering: boolean) {
  return !recovering && progress.dispatched && !progress.accepted && !progress.cleared && [400, 401, 403, 404, 410, 422].includes(Number(status));
}
export function assistantReceiptMatches(command: AssistantCommand, value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const receipt = value as { run_id?: unknown; status?: unknown };
  return command.kind === 'send' ? uuid(receipt.run_id) : typeof receipt.status === 'string' && outcomes.includes(receipt.status);
}
/** No message was dispatched while creation remained unresolved. Only an explicit
 * choice from the refreshed owned history may bind that original unsent question. */
export function bindAssistantConversation(command: AssistantCommand, threadId: string, owned: readonly { id: string }[]): AssistantCommand {
  if (command.kind !== 'send' || command.phase !== 'creating' || command.threadId || !uuid(threadId) || !owned.some(thread => thread.id === threadId)) throw new Error('Choose a current owned conversation for the original unsent question.');
  return { ...command, threadId, phase: undefined };
}
export async function clearAssistantCommand(input: { assertCurrent(): void; clear(): Promise<void>; retained(command: AssistantCommand | null): void; progress?: { cleared: boolean } }) {
  input.assertCurrent(); await input.clear();
  input.retained(null); // Durable deletion completed before a late visibility check.
  if (input.progress) input.progress.cleared = true;
  input.assertCurrent();
}

/** Every boundary uses the lease captured before the first storage await. */
export async function dispatchAssistantCommand(input: {
  command: AssistantCommand;
  assertCurrent(): void;
  retain(command: AssistantCommand): Promise<void>;
  retained(command: AssistantCommand | null): void;
  createThread(): Promise<{ id: string }>;
  dispatch(command: AssistantCommand): Promise<unknown>;
  clear(): Promise<void>;
  progress?: { dispatched: boolean; accepted: boolean; cleared: boolean };
}): Promise<AssistantCommand> {
  const { assertCurrent } = input;
  let command = { ...input.command };
  assertCurrent();
  if (!validAssistantCommand(command)) throw new Error('The original assistant action could not be verified.');
  if (command.phase === 'accepted') {
    if (input.progress) input.progress.accepted = true;
    await clearAssistantCommand(input); if (input.progress) input.progress.cleared = true;
    return command;
  }
  if (command.phase === 'creating') throw new Error('Conversation creation is unconfirmed. Refresh history and explicitly choose a conversation for the unsent question. It has not been repeated.');
  input.retained(command);
  await input.retain(command);
  assertCurrent();
  if (command.kind === 'send' && !command.threadId) {
    command = { ...command, phase: 'creating' };
    input.retained(command); await input.retain(command); assertCurrent();
    const created = await input.createThread(); assertCurrent();
    if (!uuid(created.id)) throw new Error('The server did not confirm the new conversation.');
    command = { ...command, threadId: created.id, phase: undefined };
    input.retained(command);
    await input.retain(command);
    assertCurrent();
  }
  assertCurrent(); if (input.progress) input.progress.dispatched = true;
  const receipt = await input.dispatch(command); assertCurrent();
  if (!assistantReceiptMatches(command, receipt)) throw new Error('The response did not confirm the original assistant request. Keep its exact key and check again.');
  command = { ...command, phase: 'accepted' };
  if (input.progress) input.progress.accepted = true;
  input.retained(command); await input.retain(command); assertCurrent();
  await clearAssistantCommand(input); if (input.progress) input.progress.cleared = true;
  return command;
}
