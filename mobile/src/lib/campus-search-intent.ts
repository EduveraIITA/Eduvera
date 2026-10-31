import type { NativeCampusSelection } from './native-campus';

export interface CampusSearchValue { search: string; page: number }
export interface CampusSearchIntent {
  contextKey: string;
  entryKey: string;
  observedHref: string;
  value: CampusSearchValue;
  pending: boolean;
  issuedHrefs: readonly string[];
}
interface RouteSearch extends CampusSearchValue { contextKey: string; entryKey: string; href: string }
const canonical = (href: string) => {
  const url = new URL(href, 'https://thatcampus.invalid');
  url.searchParams.sort();
  return `${url.pathname}${url.search}${url.hash}`;
};
const normalized = ({ search, page }: CampusSearchValue): CampusSearchValue => ({
  search: search.slice(0, 200), page: Math.max(1, Math.min(10000, Math.floor(page) || 1)),
});
const same = (a: CampusSearchValue, b: CampusSearchValue) => a.search === b.search && a.page === b.page;
const restored = (route: RouteSearch): CampusSearchIntent => ({
  contextKey: route.contextKey, entryKey: route.entryKey, observedHref: canonical(route.href),
  value: normalized(route), pending: false, issuedHrefs: [],
});

/** Only transient input intent, never another navigation history. Known delayed
 * echoes cannot replace a newer keystroke. Back, a new entry, a changed world or
 * publication, and an unrelated deep link always restore the route's value. */
export function receiveCampusSearchIntent(previous: CampusSearchIntent | null, route: RouteSearch): CampusSearchIntent {
  if (!previous || previous.contextKey !== route.contextKey || previous.entryKey !== route.entryKey) return restored(route);
  const href = canonical(route.href);
  if (href === previous.observedHref) return previous;
  if (!previous.pending || !previous.issuedHrefs.includes(href)) return restored(route);
  if (same(previous.value, normalized(route)) && href === previous.issuedHrefs.at(-1)) return restored(route);
  return { ...previous, observedHref: href };
}

export function editCampusSearchIntent(previous: CampusSearchIntent, value: CampusSearchValue): CampusSearchIntent {
  const next = normalized(value);
  return same(previous.value, next) ? previous : { ...previous, value: next, pending: true };
}

/** Remember only bounded in-flight route acknowledgements. Search persistence is
 * debounced by the screen; there is no navigation call for every native key. */
export function issueCampusSearchIntent(previous: CampusSearchIntent, href: string): CampusSearchIntent {
  if (!previous.pending) return previous;
  const target = canonical(href);
  if (target === previous.observedHref && !previous.issuedHrefs.length) return { ...previous, pending: false };
  return { ...previous, issuedHrefs: [...previous.issuedHrefs.filter(value => value !== target), target].slice(-32) };
}

export function campusSearchIntentChanges(intent: CampusSearchIntent | null): Record<string, string | null> {
  return intent?.pending ? { map_search: intent.value.search || null, map_page: intent.value.page > 1 ? String(intent.value.page) : null } : {};
}

/** A tap can happen before the preceding route update reaches React. Keep that
 * latest intended destination while rebasing only its local search/page values. */
export function campusSearchIntentHref(intent: CampusSearchIntent, fallbackHref: string): string {
  const url = new URL(intent.issuedHrefs.at(-1) ?? fallbackHref, 'https://thatcampus.invalid');
  for (const [key, value] of Object.entries(campusSearchIntentChanges(intent))) {
    if (value === null) url.searchParams.delete(key); else url.searchParams.set(key, value);
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

/** Route-only search/page changes do not invalidate a whole static scene crop. */
export function retainNativeCampusSelection(previous: NativeCampusSelection, next: NativeCampusSelection): NativeCampusSelection {
  return previous.selectedId === next.selectedId && previous.spaceId === next.spaceId
    && previous.buildingId === next.buildingId && previous.floorId === next.floorId ? previous : next;
}
