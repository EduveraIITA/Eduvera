import type { WorkspaceArea, WorkspaceAreaSurface, WorkspaceManifest } from '../../../packages/contracts/src/workspace';
import { isInternalHref } from './api-policy';

export type NativeAreaDestination =
  | { state: 'landing'; area: WorkspaceArea; label: string; description: string | null | undefined; surfaces: readonly WorkspaceAreaSurface[] }
  | { state: 'selected'; area: WorkspaceArea; surface: WorkspaceAreaSurface; label: string; description: string | null | undefined; href: string; surfaces: readonly [] }
  | { state: 'unavailable'; reason: 'invalid_href' | 'selector_conflict' | 'ambiguous' | 'not_contributed'; surfaces: readonly [] };

interface DestinationHref {
  pathname: string;
  selectors: ReadonlyMap<string, string>;
  duplicateSelectors: boolean;
}

function destinationHref(href: string): DestinationHref | null {
  if (!isInternalHref(href)) return null;
  try {
    const url = new URL(href, 'https://thatcampus.invalid');
    const selectors = new Map<string, string>();
    let duplicateSelectors = false;
    for (const [key, value] of url.searchParams) {
      if (selectors.has(key)) duplicateSelectors = true;
      selectors.set(key, value);
    }
    return { pathname: url.pathname, selectors, duplicateSelectors };
  } catch { return null; }
}

/**
 * Resolve only routes contributed by an already normalized, context-checked
 * manifest. This selects a destination; domain APIs still own authorization.
 * Contributed query parameters identify a surface. Other filters may vary without
 * turning a selected destination back into its area's context chooser.
 */
export function resolveNativeAreaDestination(manifest: WorkspaceManifest, href: string): NativeAreaDestination {
  const requested = destinationHref(href);
  if (!requested) return { state: 'unavailable', reason: 'invalid_href', surfaces: [] };

  const areas = manifest.areas.flatMap(area => {
    const parsed = destinationHref(area.href);
    return parsed?.pathname === requested.pathname ? [{ area, parsed }] : [];
  });
  const surfaces = manifest.areas.flatMap(area => area.surfaces.flatMap(surface => {
    const parsed = destinationHref(surface.href);
    return parsed?.pathname === requested.pathname ? [{ area, surface, parsed }] : [];
  }));
  const selectorNames = new Set([...areas, ...surfaces].flatMap(item => [...item.parsed.selectors.keys()]));

  // Only server-contributed selector names are contextual. Do not maintain a
  // guessed list of query names or treat a repeated required selector as a choice.
  const params = new URL(href, 'https://thatcampus.invalid').searchParams;
  if ([...selectorNames].some(name => params.getAll(name).length > 1)) {
    return { state: 'unavailable', reason: 'selector_conflict', surfaces: [] };
  }
  const matches = (candidate: DestinationHref) => !candidate.duplicateSelectors && [...selectorNames].every(name =>
    requested.selectors.has(name) === candidate.selectors.has(name)
      && requested.selectors.get(name) === candidate.selectors.get(name));

  // A surface that shares its area's pathname is terminal, even when its query
  // differs from a peer's. Never remove it and offer that peer as the next page.
  const selected = surfaces.filter(item => matches(item.parsed));
  if (selected.length > 1) return { state: 'unavailable', reason: 'ambiguous', surfaces: [] };
  if (selected.length === 1) {
    const { area, surface } = selected[0]!;
    return { state: 'selected', area, surface, label: surface.label, description: surface.description, href, surfaces: [] };
  }

  const landing = areas.filter(item => matches(item.parsed));
  if (landing.length > 1) return { state: 'unavailable', reason: 'ambiguous', surfaces: [] };
  if (landing.length === 1) {
    const { area } = landing[0]!;
    return {
      state: 'landing', area, label: area.label, description: area.description,
      surfaces: area.surfaces.filter(surface => {
        const parsed = destinationHref(surface.href);
        return parsed && !parsed.duplicateSelectors;
      }),
    };
  }
  return { state: 'unavailable', reason: 'not_contributed', surfaces: [] };
}
