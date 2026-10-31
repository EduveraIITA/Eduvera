export type SavedAppearance = 'system' | 'light' | 'dark';
const key = 'thatcampus:appearance';
function confirmed(value: string | null): SavedAppearance { return value === 'light' || value === 'dark' ? value : 'system'; }
export function initialAppearance(): SavedAppearance {
  try { return typeof window === 'undefined' ? 'system' : confirmed(window.localStorage.getItem(key)); }
  catch { return 'system'; }
}
export async function readAppearance(): Promise<SavedAppearance> { return confirmed(window.localStorage.getItem(key)); }
export async function saveAppearance(value: SavedAppearance) { window.localStorage.setItem(key, value); }
export function subscribeAppearance(listener: (value: SavedAppearance) => void) {
  const handle = (event: StorageEvent) => { if (event.key === key || event.key === null) listener(confirmed(event.newValue)); };
  window.addEventListener('storage', handle);
  return () => window.removeEventListener('storage', handle);
}
