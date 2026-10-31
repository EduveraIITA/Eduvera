import type { AgentRun } from '../../../../packages/contracts/src/wire/features/assistant/agentApi';
import { assistantInline, assistantRunAnswer, assistantTextBlocks, prepareNativeAssistantText } from './conversation-presentation';

export type AssistantCopySnapshot = Readonly<{ runId: string; text: string }>;
export type AssistantCopyResult = 'copied' | 'stale' | 'failed';

const plainInline = (text: string) => assistantInline(text).map(part => part.text).join('');

/** Copy only the latest authorized, recorded answer as the full reply displays it.
 * Questions, source metadata, action previews and raw inputs are never included. */
export function assistantCopySnapshot(runs: readonly AgentRun[], authorized = false): AssistantCopySnapshot | null {
  const latest = runs.at(-1);
  if (authorized !== true || !latest || latest.status === 'running' || !latest.answer.trim()) return null;
  const charts = latest.evidence.filter(source => source.chart);
  const chart = charts.length === 1 ? charts[0]!.chart : undefined;
  const text = assistantTextBlocks(prepareNativeAssistantText(assistantRunAnswer(latest), chart)).map(block => {
    if (block.kind === 'code') return block.text ?? '';
    if (block.kind === 'list') return block.items!.map(item => `${item.marker} ${plainInline(item.text)}`).join('\n');
    return plainInline(block.text ?? '');
  }).join('\n\n').trim();
  return text ? Object.freeze({ runId: latest.id, text }) : null;
}

const sameSnapshot = (expected: AssistantCopySnapshot, current: AssistantCopySnapshot | null) =>
  !!current && current.runId === expected.runId && current.text === expected.text;

/** Invoke the writer in the original user gesture, then acknowledge only the
 * same current response and lease. Never read the clipboard or retry a write. */
export async function copyAssistantResponse(input: {
  snapshot: AssistantCopySnapshot;
  readCurrent(): AssistantCopySnapshot | null;
  assertCurrent(): void;
  write(text: string): boolean | Promise<boolean>;
}): Promise<AssistantCopyResult> {
  try {
    input.assertCurrent();
    if (!sameSnapshot(input.snapshot, input.readCurrent())) return 'stale';
    input.assertCurrent();
  } catch { return 'stale'; }

  let written = false;
  try {
    // No await may precede this invocation: browser clipboard access, including
    // Safari, must retain the originating button's transient user activation.
    written = await input.write(input.snapshot.text);
  } catch { /* A rejected/refused write cannot produce a success notice. */ }

  try {
    input.assertCurrent();
    if (!sameSnapshot(input.snapshot, input.readCurrent())) return 'stale';
    input.assertCurrent();
  } catch { return 'stale'; }
  return written === true ? 'copied' : 'failed';
}
