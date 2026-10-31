/** Presentation catalogue for the actual Expo tab route owners. Route groups
 * keep Assistant's existing public URL while giving it one retained stack. */
export const ASSISTANT_TAB_HREF = '/areas/assistant/conversation' as const;
export const campusTabs = [
  { name: 'today', href: '/today', baseRouteName: 'index', label: 'Today', icon: 'today' },
  { name: 'work', href: '/work', baseRouteName: 'index', label: 'Work', icon: 'work' },
  { name: '(assistant)', href: ASSISTANT_TAB_HREF, baseRouteName: 'areas/assistant/conversation', label: 'Assistant', icon: null },
  { name: 'areas', href: '/areas', baseRouteName: 'index', label: 'Areas', icon: 'areas' },
  { name: 'more', href: '/more', baseRouteName: 'index', label: 'More', icon: 'more' },
] as const;
export type CampusTabRoot = typeof campusTabs[number]['href'];
export function campusTabForRoot(root: string) { return campusTabs.find(tab => tab.href === root); }
export function campusTabForName(name: string) { return campusTabs.find(tab => tab.name === name); }
export function campusTabForHref(href: string) {
  const path = href.split(/[?#]/)[0]?.replace(/\/$/,'');
  if (path === ASSISTANT_TAB_HREF) return campusTabForName('(assistant)');
  return campusTabs.find(tab => tab.name !== '(assistant)' && (path === tab.href || path?.startsWith(tab.href + '/')));
}
