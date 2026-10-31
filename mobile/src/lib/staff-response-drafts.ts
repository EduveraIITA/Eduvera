export type StaffResponseDraft = Readonly<{ note: string; revision: number }>;
export type StaffResponseDrafts = Readonly<Record<string, StaffResponseDraft>>;

/** The source revision is fixed by the first unsent edit, even if the list
 * refreshes, changes page, or temporarily stops rendering that record. */
export function editStaffResponseDraft(drafts: StaffResponseDrafts, id: string, revision: number, note: string): StaffResponseDrafts {
  if (!note) return clearStaffResponseDraft(drafts, id);
  return { ...drafts, [id]: { note, revision: drafts[id]?.revision ?? revision } };
}

/** An acknowledgement clears only the submitted draft; it must not erase a
 * newer local edit made while an earlier response was in flight. */
export function clearStaffResponseDraft(drafts: StaffResponseDrafts, id: string, submitted?: StaffResponseDraft): StaffResponseDrafts {
  const current = drafts[id];
  if (!current || submitted && (current.note !== submitted.note || current.revision !== submitted.revision)) return drafts;
  const next = { ...drafts }; delete next[id]; return next;
}

export function hasStaffResponseDrafts(drafts: StaffResponseDrafts): boolean {
  return Object.values(drafts).some(draft => draft.note.trim().length > 0);
}
