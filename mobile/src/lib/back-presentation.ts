import { sameCampusHref } from './back-policy';

export interface CampusBrowserPresentation {
  readonly id: string; readonly key: string; readonly href: string; readonly title?: string;
  readonly origin?: Omit<CampusBrowserPresentation,'origin'>;
}
/** Labels attached to SDK-owned browser entry IDs. There is deliberately no
 * ordered stack, index, history write, or inferred browser destination here. */
export function createCampusBrowserMetadata() {
  let scope = '', intent: { href: string; fromId: string; replacement: boolean; origin?: Omit<CampusBrowserPresentation,'origin'> } | null = null;
  const records = new Map<string,CampusBrowserPresentation>();
  const selectScope = (next: string) => { if (scope === next) return; scope = next; records.clear(); intent = null; };
  return {
    selectScope,
    get(id: string | null | undefined) { return id ? records.get(id) : undefined; },
    get pending() { return !!intent; },
    begin(href: string, source: CampusBrowserPresentation | undefined, replacement = false) {
      if (!source) { intent = null; return; }
      const { origin: _prior,...current } = source;
      intent = { href,fromId: source.id,replacement,origin: replacement ? source.origin : current };
    },
    observe(next: Omit<CampusBrowserPresentation,'origin'>): boolean {
      const previous = records.get(next.id);
      let origin = previous?.origin;
      if (intent && (intent.fromId !== next.id || intent.replacement && sameCampusHref(intent.href,next.href))) {
        if (sameCampusHref(intent.href,next.href)) origin = intent.origin;
        intent = null;
      }
      const value = { ...next,...(origin ? { origin } : {}) };
      if (previous && previous.key === value.key && previous.title === value.title && sameCampusHref(previous.href,value.href) && previous.origin === origin) return false;
      records.set(next.id,value);
      // The browser still owns older entries. Evicted labels fail to an owning
      // cold-link destination; this cache never pretends to know an absent ID.
      if (records.size > 200) records.delete(records.keys().next().value!);
      return true;
    },
    originFor(id: string | null | undefined) {
      const origin = id ? records.get(id)?.origin : undefined;
      return origin ? records.get(origin.id) ?? origin : undefined;
    },
    cancel() { intent = null; },
  };
}
