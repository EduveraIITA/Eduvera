/** Only a failed fresh read is paused. Confirmed access loss also withdraws
 * cached private data; an interrupted connection keeps its existing editor. */
export function peopleEditorCanRetain(value: unknown, error: unknown): boolean {
  return value !== null && value !== undefined && ![401, 403, 404, 410].includes(Number((error as { status?: unknown } | null)?.status));
}

export function peopleEditorHasChanges(baseline: unknown, draft: unknown): boolean {
  return JSON.stringify(baseline) !== JSON.stringify(draft);
}

/** Runs after the shared guard has rendered the acknowledged editor clean. */
export async function completePeopleEditor(completion: { assertCurrent(): void; run(): void | Promise<void> }) {
  completion.assertCurrent();
  await completion.run();
}
