import { parseAccountProPreference } from './account-capabilities';
import { campusWorkspaceTabState, focusedCampusRoute, type CampusNavigationState } from './back-policy';
/** Only the actual retained SDK tab chronology can supply Close's destination. */
export function assistantRetainedTabOrigin(state: CampusNavigationState | undefined) {
  const tabs = campusWorkspaceTabState(state), selected = tabs?.routes[tabs.index];
  if (!tabs || selected?.name !== '(assistant)') return null;
  const history = tabs.history ?? [], selectedEntry = history.at(-1), prior = history.at(-2);
  // Match the SDK's immediate GO_BACK target exactly. Never skip an invalid
  // history item to invent a more distant destination the reducer won't use.
  if (selectedEntry?.type !== 'route' || selectedEntry.key !== selected.key || prior?.type !== 'route' || !prior.key) return null;
  const route = tabs.routes.find(item => item.key === prior.key);
  if (route && route.key !== selected.key && route.name !== '(assistant)') return { tabsKey: tabs.key,tabKey: route.key,leafKey: route.state ? focusedCampusRoute(route.state)?.key ?? route.key : route.key };
  return null;
}
/** Hiding every shell escape requires known configuration, never an optimistic
 * first-load result. A cached validated true survives only transient failures. */
export function assistantPresentationPermitted(eligible: boolean, preference: unknown, errorStatus?: number): boolean {
  if (!eligible || errorStatus !== undefined && [401,403,404,410].includes(errorStatus)) return false;
  try { return parseAccountProPreference(preference).enabled; } catch { return false; }
}
/** Unknown/transient configuration must not retire a retained draft. A known
 * denial must restore usable workspace chrome, including a vanished Pro action. */
export function assistantPresentationUnavailable(eligible: boolean, preference: unknown, errorStatus?: number): boolean {
  if (!eligible || errorStatus !== undefined && [401,403,404,410].includes(errorStatus)) return true;
  try { return !parseAccountProPreference(preference).enabled; } catch { return false; }
}
