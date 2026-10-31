import React, { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { BackHandler, Keyboard, Platform } from 'react-native';
import { useIsFocused, useNavigation, usePreventRemove, useRootNavigation, useRootNavigationState, useRoute, useRouter, useUnstableGlobalHref, type Href } from 'expo-router';
import { useSession } from '../auth/SessionProvider';
import { captureApiContext } from '../lib/api';
import { campusTabForRoot } from '../lib/campus-tabs';
import { createTabConfigurationCommand, prepareTabConfigurationChange, type TabConfigurationSnapshot } from '../lib/tab-configuration';
import { canonicalNativeHref } from '../lib/navigation';
import { campusBackFallback, campusExistingBackTarget, campusHrefForRoute, campusOwnerTitle, campusRemovedGuards, campusTransitionKind, campusWorkspaceTabState, focusedCampusRoute, isCampusWorkspaceRoot, isFocusedCampusAncestor, previousCampusStackRoute, projectCampusExistingBack, projectCampusOriginReturn, projectCampusTabReset, sameCampusHref, type CampusNavigationState, type CampusRouteOrigin } from '../lib/back-policy';
import { assistantRetainedTabOrigin } from '../lib/assistant-presentation-policy';
import { captureAssistantIntentLease } from '../lib/assistant-overlay';
import { useAssistantPresentationState } from './assistant-presentation-context';
import { AssistantOverlayOwnerContext } from './assistant-overlay-context';
import { Alert } from './Alert';
import { createCampusBrowserTraversal, waitForBrowserRollback } from '../lib/back-browser-traversal';
import { createCampusBrowserMetadata, type CampusBrowserPresentation } from '../lib/back-presentation';

type Entry = { key: string; scope: string; href: string; title?: string; origin?: CampusRouteOrigin; originTitle?: string };
type BackDeclaration = { id: string; key: string; scope: string; fallbackHref?: string; title?: string; disabled?: boolean; onPress?: () => void; preservesDraft?: true; priority?: number };
export interface ScreenExitGuard { blocked?: boolean; dirty?: boolean; title?: string; message?: string; onLeave?: () => void; draftSignature?: string }
type Guard = ScreenExitGuard & { id: string; key: string; scope: string; assistant?: boolean };
type Boundary = { id: string; key: string; scope: string; allow: (action: () => void) => void; releasing: () => boolean };
type HeaderBack = { hasOrigin: boolean; visible: boolean; label: string; disabled: boolean; custom: boolean; onPress: () => void };
type Pending = { fromKey: string; scope: string; href: string; originKey?: string; originTitle?: string };
type Completion = { key: string; scope: string; from: string; to: string; transport: ReturnType<typeof captureApiContext> };
export interface TabConfigurationOperation { acknowledge(): void; finish(confirmed: boolean): void }
type TabChange = { scope: string; caller: string };
type Model = {
  scope: string; enabled: boolean; state: CampusNavigationState | undefined; href: string;
  entries: Map<string, Entry>; declarations: Map<string, BackDeclaration>; guards: Map<string, Guard>;
  boundaries: Map<string, Boundary>; pending: Pending | null; completion: Completion | null; retiredKeys: Set<string>; tabChange?: TabChange;
};
type BackContext = {
  version: number; model: React.RefObject<Model>;
  registerTitle(key: string, scope: string, title: string): void;
  registerBack(value: BackDeclaration): () => void; registerGuard(value: Guard): () => void;
  registerBoundary(value: Boundary): () => void; boundaryOwner(key: string): string | undefined;
  header(key?: string): HeaderBack;
  navigate(caller: string, scope: string, from: string | undefined, target: string, complete?: boolean, originTitle?: string): void;
  collapseAssistant(key: string): boolean; closeAssistant(caller: string, scope: string): void; assistantIntent(caller: string,scope: string,action: () => void): void;
  back(key: string): void; preventing(key: string): boolean;
  confirm(key: string, action: () => void, losing?: boolean, onCancel?: () => void): void;
  approvedBack(key: string): void;
  browserReplay(key: string): { ready: () => Promise<void>; traverse: () => void; cancel: () => void } | null;
  prepareTabConfiguration(caller: string, scope: string, enabled: boolean, action: (operation: TabConfigurationOperation) => void): void;
  selectTab(caller: string, scope: string, root: string): void; reselectTab(caller: string, scope: string, root: string): void; tabHref(root: string): string;
};
const Context = createContext<BackContext | null>(null);
const hidden: HeaderBack = { hasOrigin: false, visible: false, label: 'Back', disabled: false, custom: false, onPress() {} };
const routeKeys = (state: CampusNavigationState | undefined, result = new Set<string>()): Set<string> => {
  for (const route of state?.routes ?? []) { result.add(route.key); routeKeys(route.state, result); } return result;
};
const frame = (callback: () => void) => typeof requestAnimationFrame === 'function' ? requestAnimationFrame(callback) : setTimeout(callback, 0);

/** The Expo navigation tree is the sole stack. These are scoped labels and links
 * between its real entries, not a second route history. */
export function BackNavigationProvider({ children }: React.PropsWithChildren) {
  const session = useSession(), { scopeKey } = session, assistantPresentation = useAssistantPresentationState();
  const presentationRef = useRef(assistantPresentation); presentationRef.current = assistantPresentation;
  const router = useRouter(), navigation = useRootNavigation(), tree = useRootNavigationState();
  const globalHref = useUnstableGlobalHref();
  const [version, bump] = useState(0), prompts = useRef(new Set<string>());
  const browser = useRef(createCampusBrowserMetadata()).current; browser.selectScope(scopeKey);
  const traversal = useRef(createCampusBrowserTraversal()).current, replayLease = useRef<string | null>(null);
  const model = useRef<Model>({ scope: scopeKey, enabled: false, state: undefined, href: '/today', entries: new Map(), declarations: new Map(), guards: new Map(), boundaries: new Map(), pending: null, completion: null, retiredKeys: new Set() });
  const current = model.current;
  if (current.scope !== scopeKey) {
    for (const key of routeKeys(current.state)) current.retiredKeys.add(key);
    current.scope = scopeKey; current.entries.clear(); current.declarations.clear(); current.guards.clear(); current.boundaries.clear(); current.pending = null; current.completion = null; current.tabChange = undefined; prompts.current.clear(); traversal.clear(); replayLease.current = null;
  }
  current.state = tree as CampusNavigationState | undefined;
  try { current.href = canonicalNativeHref(globalHref); } catch { current.href = '/today'; }
  const focused = focusedCampusRoute(current.state);
  // Index routes can retain stale catch-all params after a tab reset. The real
  // leaf name/path owns routing; unstable_globalHref is only a startup fallback.
  const focusedHref = focused && current.state && campusHrefForRoute(current.state,focused.key);
  if (focusedHref) current.href = canonicalNativeHref(focusedHref);
  current.enabled = session.ready && session.status === 'authenticated' && !!session.user?.id && !!focused && !current.retiredKeys.has(focused.key);
  if (focused && current.enabled) {
    const old = current.entries.get(focused.key);
    const entry: Entry = old?.scope === scopeKey ? { ...old, href: current.href } : { key: focused.key, scope: scopeKey, href: current.href };
    const pending = current.pending;
    if (pending && pending.scope === scopeKey && focused.key !== pending.fromKey) {
      if (sameCampusHref(pending.href, current.href) && pending.originKey && current.entries.get(pending.originKey)?.scope === scopeKey) { entry.origin = { scopeKey, destinationKey: focused.key, originKey: pending.originKey }; entry.originTitle = pending.originTitle; }
      current.pending = null;
    }
    current.entries.set(focused.key, entry);
  }
  const change = useCallback(() => bump(value => value + 1), []);
  const selectedBack = (key: string) => [...model.current.declarations.values()].filter(item => item.key === key && item.scope === model.current.scope).sort((a,b) => (b.priority ?? 0) - (a.priority ?? 0)).at(0);
  const matchingGuards = (key: string) => [...model.current.guards.values()].filter(item => item.key === key && item.scope === model.current.scope);
  const valid = (key: string, scope = model.current.scope) => model.current.enabled && scope === model.current.scope && focusedCampusRoute(model.current.state)?.key === key;
  const allow = (key: string, action: () => void) => {
    const boundary = [...model.current.boundaries.values()].find(item => item.key === key && item.scope === model.current.scope);
    if (boundary) boundary.allow(action); else action();
  };
  const browserEntry = (): CampusBrowserPresentation | undefined => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const m = model.current, path = window.location.pathname + window.location.search + window.location.hash;
    if (!sameCampusHref(m.href,path)) return;
    const id = window.history.state?.id, key = focusedCampusRoute(m.state)?.key;
    if (typeof id !== 'string' || !key || !m.enabled) return;
    browser.observe({ id,key,href: m.href,title: m.entries.get(key)?.title });
    return browser.get(id);
  };
  const tabState = () => campusWorkspaceTabState(model.current.state);
  const tabHref = (root: string) => {
    const owner = campusTabForRoot(root); if (!owner) return root;
    const name = owner.name, tabs = tabState(), route = tabs?.routes.find(item => item.name === name);
    // Modified clicks/new tabs always retain ordinary anchor behavior. The
    // active tab advertises its deliberate base destination; inactive tabs
    // advertise their retained current screen.
    if (tabs?.routes[tabs.index]?.name === name) return owner.href;
    const leaf = route?.state ? focusedCampusRoute(route.state) : route;
    return leaf && model.current.state ? campusHrefForRoute(model.current.state,leaf.key) ?? model.current.entries.get(leaf.key)?.href ?? owner.href : owner.href;
  };
  const confirm = (key: string, action: () => void, losing = true, onCancel?: () => void) => {
    const m = model.current, scope = m.scope, href = m.href;
    if (m.tabChange || !valid(key) || prompts.current.has(key) || losing && selectedBack(key)?.disabled || [...m.boundaries.values()].some(item => item.key === key && item.scope === scope && item.releasing())) { onCancel?.(); return; }
    let transport: ReturnType<typeof captureApiContext>;
    try { transport = captureApiContext(); } catch { onCancel?.(); return; }
    const guards = matchingGuards(key);
    if (guards.some(item => item.blocked)) { onCancel?.(); return; }
    const dirty = losing ? guards.filter(item => item.dirty) : [];
    const proceed = () => {
      try { transport.assertCurrent(); } catch { onCancel?.(); return; }
      if (!valid(key,scope) || !sameCampusHref(model.current.href,href) || matchingGuards(key).some(item => item.blocked)) { onCancel?.(); return; }
      for (const guard of dirty) guard.onLeave?.();
      action();
    };
    if (!dirty.length) { proceed(); return; }
    prompts.current.add(key);
    let settled = false;
    const finish = (leave: boolean) => { if (settled) return; settled = true; prompts.current.delete(key); if (leave) proceed(); else onCancel?.(); };
    Alert.alert(dirty[0]?.title || 'Discard unsaved changes?', dirty[0]?.message || 'Your unsaved changes on this screen will be lost.', [
      { text: 'Keep editing', style: 'cancel', onPress: () => finish(false) },
      { text: 'Discard and leave', style: 'destructive', onPress: () => finish(true) },
    ], { cancelable: true, onDismiss: () => finish(false) });
  };
  const reselectTab = (caller: string, scope: string, root: string) => {
    const m = model.current, key = focusedCampusRoute(m.state)?.key;
    if (m.tabChange || !key || !m.state || !navigation || !valid(key,scope) || !isFocusedCampusAncestor(m.state,caller) || prompts.current.has(key) || selectedBack(key)?.disabled || [...m.boundaries.values()].some(item => item.key === key && item.scope === scope && item.releasing())) return;
    const source = m.state, href = m.href;
    const plan = projectCampusTabReset(source, { root,focusedKey: key,scopeKey: scope },m.scope);
    if (!plan) return;
    const removed = campusRemovedGuards(m.guards.values(),plan.removedKeys,scope);
    if (removed.blocked) return;
    let transport: ReturnType<typeof captureApiContext>;
    try { transport = captureApiContext(); } catch { return; }
    const signature = () => [...model.current.guards.values()].filter(item => item.scope === scope && plan.removedKeys.includes(item.key)).map(item => `${item.id}:${item.dirty}:${item.blocked}:${item.draftSignature ?? ''}`).sort().join('|');
    const guarded = signature();
    const proceed = () => {
      try { transport.assertCurrent(); } catch { return; }
      if (!valid(key,scope) || model.current.state !== source || !sameCampusHref(model.current.href,href) || signature() !== guarded || campusRemovedGuards(model.current.guards.values(),plan.removedKeys,scope).blocked) return;
      // Only these removed editors lose their drafts. Other retained tabs keep
      // every component/key and do not participate in this confirmation.
      for (const guard of removed.dirty) guard.onLeave?.();
      allow(key,() => {
        try { transport.assertCurrent(); } catch { return; }
        if (!valid(key,scope) || model.current.state !== source) return;
        browser.begin(plan.root,browserEntry(),true);
        m.pending = null; m.completion = null;
        for (const removedKey of plan.removedKeys) m.entries.delete(removedKey);
        // Invalidate old route callbacks before the SDK's React commit. The
        // actual root RESET is one atomic projection, never a second stack.
        m.state = plan.state; m.href = plan.root;
        navigation.dispatch({ type: 'RESET',target: source.key,payload: plan.state });
      });
    };
    if (!removed.dirty.length) { proceed(); return; }
    prompts.current.add(key);
    let settled = false;
    const finish = (leave: boolean) => { if (settled) return; settled = true; prompts.current.delete(key); if (leave) proceed(); };
    Alert.alert(removed.dirty[0]?.title || 'Discard unsaved changes?',removed.dirty[0]?.message || 'Unsaved changes in this tab will be lost when you return to its main page.',[
      { text: 'Keep editing',style: 'cancel',onPress: () => finish(false) },
      { text: 'Discard and return',style: 'destructive',onPress: () => finish(true) },
    ],{ cancelable: true,onDismiss: () => finish(false) });
  };
  const performBack = (key: string) => {
    const m = model.current;
    if (!valid(key)) return;
    if (assistantPresentation.mode === 'fullscreen') { assistantPresentation.setExpanded(key,m.scope,false); return; }
    const declaration = selectedBack(key);
    if (declaration?.disabled || matchingGuards(key).some(item => item.blocked)) return;
    if (declaration?.onPress) { declaration.onPress(); return; }
    const entry = m.entries.get(key), origin = entry?.origin, prior = origin && m.entries.get(origin.originKey);
    if (Platform.OS === 'web' && typeof window !== 'undefined' && browser.originFor(browserEntry()?.id)) { window.history.back(); return; }
    if (Platform.OS !== 'web' && origin && prior?.scope === m.scope && m.state) {
      const projected = projectCampusOriginReturn(m.state, origin, m.scope);
      if (projected) { navigation?.dispatch({ type: 'RESET', target: m.state.key, payload: projected }); return; }
    }
    const previous = previousCampusStackRoute(m.state), known = previous && m.entries.get(previous.key);
    if (Platform.OS !== 'web' && known?.scope === m.scope) { router.back(); return; }
    const fallback = declaration?.fallbackHref ?? campusBackFallback(entry?.href ?? m.href)?.href;
    if (!fallback || sameCampusHref(fallback, entry?.href ?? m.href)) return;
    const anchor = campusExistingBackTarget(m.state, fallback);
    const projected = anchor && m.state && projectCampusExistingBack(m.state, key, anchor.key);
    if (projected) { navigation?.dispatch({ type: 'RESET', target: m.state!.key, payload: projected }); return; }
    router.replace(canonicalNativeHref(fallback) as Href);
  };
  const requestBack = (key: string) => {
    const m = model.current;
    if (valid(key) && assistantPresentation.mode === 'fullscreen') { assistantPresentation.setExpanded(key,m.scope,false); return; }
    if (m.tabChange || !valid(key) || prompts.current.has(key) || selectedBack(key)?.disabled || matchingGuards(key).some(item => item.blocked) || [...m.boundaries.values()].some(item => item.key === key && item.scope === m.scope && item.releasing())) return;
    try { captureApiContext().assertCurrent(); } catch { return; }
    if (Platform.OS === 'web' && !selectedBack(key)?.onPress && browser.originFor(browserEntry()?.id)) {
      // A real browser traversal may merely select another retained tab. Let
      // SDK58 decide whether it actually REMOVES the editor before prompting;
      // pre-confirming here would discard a draft that otherwise stays mounted.
      performBack(key); return;
    }
    const local = selectedBack(key);
    if (local?.onPress && local.preservesDraft === true) {
      // A reviewed local chooser/camera close keeps its parent draft. Do not
      // release SDK removal prevention: any actual route exit still loses the
      // draft and must pass the ordinary dirty/busy guards.
      confirm(key,() => performBack(key),false); return;
    }
    confirm(key,() => allow(key,() => performBack(key)));
  };
  const header = (requested?: string): HeaderBack => {
    const m = model.current, key = requested ?? focusedCampusRoute(m.state)?.key;
    if (!key || !valid(key)) return hidden;
    if (assistantPresentation.mode === 'fullscreen') return { hasOrigin: !!assistantRetainedTabOrigin(m.state),visible: true,label: 'Collapse Assistant',disabled: false,custom: true,onPress: () => assistantPresentation.setExpanded(key,m.scope,false) };
    const declaration = selectedBack(key), entry = m.entries.get(key);
    if (isCampusWorkspaceRoot(entry?.href ?? m.href) && !declaration?.onPress) return hidden;
    const savedOrigin = entry?.origin, candidate = savedOrigin && m.entries.get(savedOrigin.originKey);
    const origin = candidate?.scope === m.scope && (Platform.OS === 'web' || !!m.state && !!savedOrigin && !!projectCampusOriginReturn(m.state,savedOrigin,m.scope)) ? candidate : undefined;
    const previous = previousCampusStackRoute(m.state), previousEntry = previous && m.entries.get(previous.key);
    const webOrigin = Platform.OS === 'web' ? browser.originFor(browserEntry()?.id) : undefined;
    const actual = Platform.OS === 'web' ? webOrigin : origin ?? (previousEntry?.scope === m.scope ? previousEntry : undefined);
    const fallback = campusBackFallback(entry?.href ?? m.href);
    const visible = !!declaration?.onPress || !!actual || !!declaration?.fallbackHref && !sameCampusHref(declaration.fallbackHref,entry?.href ?? m.href) || !!fallback;
    const custom = !!declaration?.onPress || !actual || !!origin && origin.key !== previous?.key;
    return { hasOrigin: !!actual, visible, label: declaration?.onPress ? declaration.title || 'Back' : actual ? entry?.originTitle || actual.title || campusOwnerTitle(actual.href) : declaration?.title || fallback?.title || 'Back', disabled: !!m.tabChange || !!declaration?.disabled || matchingGuards(key).some(item => item.blocked) || Platform.OS === 'web' && browser.pending && !browserEntry(), custom, onPress: () => requestBack(key) };
  };
  const configurationSnapshot = (caller: string, scope: string): TabConfigurationSnapshot | null => {
    const m = model.current, key = focusedCampusRoute(m.state)?.key;
    return key && m.state && valid(key,scope) && isFocusedCampusAncestor(m.state,caller) ? { scope,focusedKey: key,href: m.href,state: m.state,guards: [...m.guards.values()],resetsCampusHost: Platform.OS === 'ios' } : null;
  };
  const value: BackContext = { version, model,
    collapseAssistant(key) { const m = model.current; if (!valid(key) || assistantPresentation.mode !== 'fullscreen') return false; assistantPresentation.setExpanded(key,m.scope,false); return true; },
    closeAssistant(caller,scope) {
      const m = model.current,key = focusedCampusRoute(m.state)?.key;
      if (!key || !valid(key,scope) || !isFocusedCampusAncestor(m.state,caller)) return;
      assistantPresentation.close(caller,scope);
    },
    assistantIntent(caller,scope,action) {
      const m = model.current,key = focusedCampusRoute(m.state)?.key,tree = m.state,href = m.href;
      if (!key || !valid(key,scope) || !isFocusedCampusAncestor(tree,caller)) return;
      const guards = [...m.guards.values()].filter(item => item.scope === scope && item.assistant), signature = () => [...model.current.guards.values()].filter(item => item.scope === scope && item.assistant).map(item => `${item.id}:${item.dirty}:${item.blocked}:${item.draftSignature ?? ''}`).sort().join('|');
      const assertIntent = captureAssistantIntentLease(() => valid(key,scope) ? { scope: model.current.scope,key: focusedCampusRoute(model.current.state)!.key,href: model.current.href,state: model.current.state,signature: signature(),entryToken: presentationRef.current.entryToken } : null);
      if (guards.some(item => item.blocked) || prompts.current.has(key)) return;
      let transport: ReturnType<typeof captureApiContext>; try { transport = captureApiContext(); } catch { return; }
      const commit = () => { try { transport.assertCurrent(); assertIntent(); } catch { return; } if (!valid(key,scope) || model.current.state !== tree || model.current.href !== href) return; for (const guard of guards.filter(item => item.dirty)) guard.onLeave?.(); action(); };
      const dirty = guards.filter(item => item.dirty); if (!dirty.length) { commit(); return; }
      prompts.current.add(key); let settled = false; const finish = (accepted: boolean) => { if (settled) return; settled = true; prompts.current.delete(key); if (accepted) commit(); };
      Alert.alert('Open the linked Assistant conversation?',dirty[0]?.message || 'Your unsent question will be discarded. Saved conversations stay available.',[{ text: 'Keep editing',style: 'cancel',onPress: () => finish(false) },{ text: 'Discard and open',style: 'destructive',onPress: () => finish(true) }],{ cancelable: true,onDismiss: () => finish(false) });
    },
    prepareTabConfiguration(caller,scope,enabled,action) {
      const key = focusedCampusRoute(model.current.state)?.key;
      if (!key || prompts.current.has(key) || model.current.tabChange) return;
      let transport: ReturnType<typeof captureApiContext>;
      try { transport = captureApiContext(); } catch { return; }
      void prepareTabConfigurationChange({ read: () => configurationSnapshot(caller,scope),enabled,assertActive: () => transport.assertCurrent(),
        confirm: guards => new Promise<boolean>(resolve => {
          prompts.current.add(key); let settled = false;
          const finish = (discard: boolean) => { if (settled) return; settled = true; prompts.current.delete(key); resolve(discard); };
          Alert.alert('Change Assistant navigation?',guards[0]?.message || 'Unsaved changes in the affected screens will be discarded when Assistant navigation changes.',[
            { text: 'Keep editing',style: 'cancel',onPress: () => finish(false) },
            { text: 'Discard and continue',style: 'destructive',onPress: () => finish(true) },
          ],{ cancelable: true,onDismiss: () => finish(false) });
        }),
        dispatch: permit => {
          const operation: TabChange = { scope,caller };
          model.current.tabChange = operation;
          // Pointer prevention also needs to resign an already-focused input:
          // otherwise the on-screen/hardware keyboard can still edit beneath it.
          Keyboard.dismiss();
          if (Platform.OS === 'web' && typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) document.activeElement.blur();
          change();
          const retire = () => { if (model.current.tabChange === operation) { model.current.tabChange = undefined; change(); } };
          const command = createTabConfigurationCommand({ permit,read: () => configurationSnapshot(caller,scope),
            assertActive() { transport.assertCurrent(); if (model.current.tabChange !== operation || !configurationSnapshot(caller,scope)) throw new Error('The preference view changed.'); },
            onRetire: retire,
          });
          try { action(command); } catch { command.retire(); }
        },
      });
    },
    registerTitle(key, scope, title) {
      const entry = model.current.entries.get(key);
      if (!valid(key,scope) || !entry || entry.title === title) return;
      entry.title = title; change();
    },
    registerBack(item) { model.current.declarations.set(item.id,item); change(); return () => { model.current.declarations.delete(item.id); change(); }; },
    registerGuard(item) { model.current.guards.set(item.id,item); change(); return () => { model.current.guards.delete(item.id); change(); }; },
    registerBoundary(item) { model.current.boundaries.set(item.id,item); change(); return () => { model.current.boundaries.delete(item.id); change(); }; },
    boundaryOwner(key) { return [...model.current.boundaries.values()].find(item => item.key === key && item.scope === model.current.scope)?.id; },
    header, confirm, tabHref, reselectTab,
    selectTab(caller,scope,root) {
      const owner = campusTabForRoot(root); if (!owner) return;
      const m = model.current, key = focusedCampusRoute(m.state)?.key, tabs = tabState();
      if (m.tabChange || !key || !tabs || !valid(key,scope) || !isFocusedCampusAncestor(m.state,caller)) return;
      const name = owner.name, route = tabs.routes.find(item => item.name === name);
      // SDK58 lazily creates tabs: declared routeNames can exist before a route
      // is materialized. JUMP_TO owns creating that first real tab entry.
      if (!tabs.routeNames?.includes(name)) return;
      if (route && tabs.routes[tabs.index]?.key === route.key) { reselectTab(caller,scope,root); return; }
      confirm(key,() => {
        browser.begin(tabHref(root),browserEntry());
        navigation?.dispatch({ type: 'JUMP_TO',target: tabs.key,payload: { name,...(route?.params ? { params: route.params } : {}) } });
      },false);
    },
    preventing(key) { const item = header(key); return !!model.current.tabChange || Platform.OS !== 'web' && item.visible && item.custom || matchingGuards(key).some(item => item.dirty || item.blocked); },
    back(key) { requestBack(key); },
    approvedBack(key) { if (valid(key)) performBack(key); },
    browserReplay(key) {
      if (Platform.OS !== 'web' || typeof window === 'undefined' || !window.navigation || !valid(key)) return null;
      const captured = traversal.capture(), browserNavigation = window.navigation;
      if (!captured) return null;
      const scope = model.current.scope, href = model.current.href, claim = `${scope}:${captured.source.key}:${captured.target.key}`;
      let transport: ReturnType<typeof captureApiContext>;
      try { transport = captureApiContext(); } catch { return null; }
      replayLease.current = claim;
      const assertCurrent = () => {
        transport.assertCurrent();
        const stillPending = traversal.capture();
        if (!valid(key,scope) || !sameCampusHref(model.current.href,href) || stillPending?.source.key !== captured.source.key || stillPending?.target.key !== captured.target.key || replayLease.current !== claim) throw new Error('The campus navigation context changed.');
      };
      return {
        ready: () => waitForBrowserRollback(captured,{
          currentKey: () => browserNavigation.currentEntry?.key ?? null,
          hasKey: wanted => browserNavigation.entries().some(entry => entry.key === wanted),
          onChange: listener => { browserNavigation.addEventListener('currententrychange',listener); return () => browserNavigation.removeEventListener('currententrychange',listener); },
        },assertCurrent),
        traverse() {
          assertCurrent(); replayLease.current = null; traversal.clear();
          // Re-traverse the exact REAL browser entry. SDK repeat() replays only
          // RESET and would replace the source history slot instead of going Back.
          void browserNavigation.traverseTo(captured.target.key).finished?.catch(() => {});
        },
        cancel() { if (replayLease.current === claim) { replayLease.current = null; traversal.clear(); } },
      };
    },
    navigate(caller, scope, fromHref, target, completed = false, originTitle) {
      const m = model.current, key = focusedCampusRoute(m.state)?.key;
      if (m.tabChange || !key || !valid(key,scope) || !isFocusedCampusAncestor(m.state,caller)) return;
      const from = fromHref ?? m.href;
      if (fromHref && !sameCampusHref(fromHref,m.href)) return;
      // A visible tablet conversation remains alongside its owning app source.
      // Its links follow ordinary app chronology, including same-href no-ops.
      if (assistantPresentation.mode === 'split' && originTitle === 'Assistant') originTitle = undefined;
      const to = canonicalNativeHref(target), kind = campusTransitionKind(from,to);
      if (kind === 'none') {
        if (to.split(/[?#]/)[0] === '/areas/assistant/conversation') assistantPresentation.open(caller,scope,to,true);
        else if (originTitle) assistantPresentation.close(caller,scope);
        return;
      }
      if (completed) {
        // Caller owns proof of accepted completion. This only replaces the editor
        // presentation and carries its REAL originating entry forward.
        try { m.completion = { key,scope,from,to,transport: captureApiContext() }; change(); } catch { /* The accepted presentation cannot cross a session binding. */ }
        return;
      }
      if (kind === 'return') { requestBack(key); return; }
      if (kind === 'update') {
        // A same-instance date/person/source change can replace a writer.
        confirm(key, () => allow(key, () => {
          // A writer's source change must mint a replacement key. Otherwise a
          // later browser snapshot can change its params without removing the
          // key, which SDK removal guards cannot observe. No history is added.
          if (matchingGuards(key).length) {
            const original = m.entries.get(key)?.origin;
            m.pending = { fromKey: key,scope,href: to,...(original ? { originKey: original.originKey } : {}) };
            browser.begin(to,browserEntry(),true); router.replace(to as Href); return;
          }
          const oldUrl = new URL(from,'https://thatcampus.invalid'), next = new URL(to,'https://thatcampus.invalid'), params: Record<string,string | string[] | undefined> = {};
          for (const name of new Set([...oldUrl.searchParams.keys(),...next.searchParams.keys()])) { const values = next.searchParams.getAll(name); params[name] = values.length > 1 ? values : values[0]; }
          router.setParams(params);
        })); return;
      }
      // PUSH retains the original keyed instance, including its safe draft.
      confirm(key, () => {
        if (m.pending) return;
        m.entries.set(key,{ ...(m.entries.get(key) ?? { key,scope }),href: from });
        m.pending = { fromKey: key,scope,href: to,originKey: key,...(originTitle ? { originTitle } : {}) }; const source = browserEntry(); browser.begin(to,source && originTitle ? { ...source,title: originTitle } : source); router.push(to as Href);
      }, false);
    },
  };
  useEffect(() => {
    const m = model.current, operation = m.tabChange;
    if (operation && (!m.enabled || !configurationSnapshot(operation.caller,operation.scope))) { m.tabChange = undefined; change(); }
  },[tree,scopeKey,session.status,version]);
  // Accepted commands commonly finish before their busy=false render commits.
  // Queue ONLY their presentation replacement, never the domain command.
  useEffect(() => {
    const m = model.current, completed = m.completion;
    if (!completed) return;
    try { completed.transport.assertCurrent(); } catch { m.completion = null; return; }
    if (!valid(completed.key,completed.scope) || !sameCampusHref(completed.from,m.href)) { m.completion = null; return; }
    if (matchingGuards(completed.key).some(item => item.blocked)) return;
    m.completion = null;
    allow(completed.key,() => {
      const original = m.entries.get(completed.key)?.origin;
      m.pending = { fromKey: completed.key,scope: completed.scope,href: completed.to,...(original ? { originKey: original.originKey } : {}) };
      browser.begin(completed.to,browserEntry(),true);
      router.replace(completed.to as Href);
    });
  }, [version,tree,scopeKey,session.status]);
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined' || !window.navigation) return;
    const browserNavigation = window.navigation;
    const changed = (event: NavigationCurrentEntryChangeEvent) => {
      const target = browserNavigation.currentEntry;
      if (target) traversal.changed(event.navigationType,event.from,target);
    };
    browserNavigation.addEventListener('currententrychange',changed);
    return () => { browserNavigation.removeEventListener('currententrychange',changed); traversal.clear(); };
  }, [scopeKey]);
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      const m = model.current;
      // Reload/closing the browser removes every retained tab, not merely its
      // focused page. Persisted safe edits never set dirty and do not warn.
      if (!m.tabChange && ![...m.guards.values()].some(guard => guard.scope === m.scope && (guard.dirty || guard.blocked))) return;
      event.preventDefault(); event.returnValue = '';
    };
    window.addEventListener('beforeunload',beforeUnload);
    return () => window.removeEventListener('beforeunload',beforeUnload);
  }, [scopeKey]);
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    let cancelled = false;
    const observe = () => {
      const m = model.current, key = focusedCampusRoute(m.state)?.key;
      const path = window.location.pathname + window.location.search + window.location.hash;
      const id = window.history.state?.id;
      if (!m.enabled || !key || typeof id !== 'string' || !sameCampusHref(m.href,path)) return false;
      if (browser.observe({ id,key,href: m.href,title: m.entries.get(key)?.title })) change();
      const pendingTraversal = traversal.capture();
      if (!replayLease.current && !prompts.current.size && pendingTraversal && window.navigation?.currentEntry?.key === pendingTraversal.target.key) traversal.clear();
      return true;
    };
    let attempts = 0;
    const synchronize = () => { if (cancelled) return; if (!observe() && ++attempts < 5) frame(synchronize); };
    synchronize();
    const onPop = () => frame(() => { if (!cancelled) observe(); });
    window.addEventListener('popstate',onPop);
    return () => { cancelled = true; window.removeEventListener('popstate',onPop); };
  }, [tree,globalHref,version,scopeKey]);
  useEffect(() => { const keys = routeKeys(model.current.state); for (const key of model.current.entries.keys()) if (!keys.has(key)) model.current.entries.delete(key); }, [tree,scopeKey]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useCampusNavigation(currentHref?: string) {
  const context = useContext(Context), route = useRoute(), { scopeKey } = useSession(), focused = useIsFocused();
  const latest = useRef({ context,currentHref,scopeKey,focused,key: route.key }); latest.current = { context,currentHref,scopeKey,focused,key: route.key };
  const navigate = useCallback((href: string, completed = false) => { const value = latest.current; if (value.focused) value.context?.navigate(value.key,value.scopeKey,value.currentHref,href,completed); }, []);
  return { onNavigate: useCallback((href: string) => navigate(href),[navigate]), complete: useCallback((href: string) => navigate(href,true),[navigate]),
    selectTab: useCallback((root: string) => { const value = latest.current; if (value.focused) value.context?.selectTab(value.key,value.scopeKey,root); },[]),
    reselectTab: useCallback((root: string) => { const value = latest.current; if (value.focused) value.context?.reselectTab(value.key,value.scopeKey,root); },[]),
    canCloseAssistant: !!context?.model.current.enabled,
    assistantIntent: useCallback((action: () => void) => { const value = latest.current; if (value.focused) value.context?.assistantIntent(value.key,value.scopeKey,action); },[]),
    onAssistantNavigate: useCallback((href: string) => { const value = latest.current; if (value.focused) value.context?.navigate(value.key,value.scopeKey,undefined,href,false,'Assistant'); },[]),
    closeAssistant: useCallback(() => { const value = latest.current; if (value.focused) value.context?.closeAssistant(value.key,value.scopeKey); },[]),
    configurationRevision: context?.version ?? 0,
    tabConfigurationBusy: !!context?.model.current.tabChange,
    tabSelectionBlocked: !context?.model.current.enabled || !!context?.model.current.tabChange || [...context.model.current.guards.values()].some(guard => guard.key === focusedCampusRoute(context.model.current.state)?.key && guard.scope === scopeKey && guard.blocked),
    configurationEntry: focusedCampusRoute(context?.model.current.state)?.key ?? '',
    prepareTabConfiguration: useCallback((enabled: boolean, action: (operation: TabConfigurationOperation) => void) => { const value = latest.current; if (value.focused) value.context?.prepareTabConfiguration(value.key,value.scopeKey,enabled,action); },[]),
    tabHref: useCallback((root: string) => latest.current.context?.tabHref(root) ?? root,[]) }; 
}
export function useHeaderBack(routeKey?: string): HeaderBack { return useContext(Context)?.header(routeKey) ?? hidden; }
/** Reviewed local returns only. The callback retains the parent draft and owns
 * any nested-loss confirmation; actual route removal remains SDK-guarded. */
type ScreenBackProps = { fallbackHref?: string; title?: string; disabled?: boolean; priority?: number } &
  ({ onPress: () => void; preservesDraft?: true } | { onPress?: () => void; preservesDraft?: undefined });
export function ScreenBack({ fallbackHref, title, disabled, onPress, preservesDraft, priority = 0 }: ScreenBackProps) {
  const context = useContext(Context), route = useRoute(), { scopeKey } = useSession(), focused = useIsFocused(), id = useId(), callback = useRef(onPress); callback.current = onPress;
  useLayoutEffect(() => {
    if (!context || !focused || focusedCampusRoute(context.model.current.state)?.key !== route.key) return;
    return context.registerBack({ id,key: route.key,scope: scopeKey,...(fallbackHref ? { fallbackHref: canonicalNativeHref(fallbackHref) } : {}),title,disabled,priority,...(onPress ? { onPress: () => callback.current?.(),...(preservesDraft === true ? { preservesDraft: true as const } : {}) } : {}) });
  }, [context?.model,focused,route.key,scopeKey,fallbackHref,title,disabled,priority,!!onPress,preservesDraft]);
  return null;
}
export function useScreenExitGuard(options: ScreenExitGuard) {
  const context = useContext(Context), assistant = useContext(AssistantOverlayOwnerContext), route = useRoute(), { scopeKey } = useSession(), id = useId(), callback = useRef(options.onLeave); callback.current = options.onLeave;
  const present = !!context && context.model.current.scope === scopeKey && routeKeys(context.model.current.state).has(route.key);
  useLayoutEffect(() => {
    // Retained screens still own drafts. Normal tab switches remove no keys;
    // an explicit tab reset must also protect a mounted editor below a detail.
    if (!context || !present) return;
    return context.registerGuard({ ...options,id,key: route.key,scope: scopeKey,assistant,onLeave: () => callback.current?.() });
  }, [context?.model,present,route.key,scopeKey,options.blocked,options.dirty,options.title,options.message,options.draftSignature,assistant]);
}
export function usePageNavigationTitle(title: string) {
  const context = useContext(Context), route = useRoute(), navigation = useNavigation(), focused = useIsFocused(), { scopeKey } = useSession(), id = useId();
  const [released,setReleased] = useState(false), releasedRef = useRef(false), releaseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const releaseSignature = useRef('');
  const latest = useRef(context); latest.current = context;
  const disableRef = useRef<() => void>(() => {}), mounted = useRef(true);
  const active = focused && focusedCampusRoute(context?.model.current.state)?.key === route.key;
  const guardSignature = context ? [...context.model.current.guards.values()].filter(item => item.key === route.key).map(item => `${item.id}:${item.dirty}:${item.blocked}:${item.draftSignature ?? ''}`).join('|') : '';
  const declarationSignature = context ? [...context.model.current.declarations.values()].filter(item => item.key === route.key).map(item => `${item.id}:${item.fallbackHref}:${item.priority}:${!!item.onPress}:${!!item.preservesDraft}`).join('|') : '';
  const signature = `${scopeKey}:${route.key}:${context?.model.current.href}:${active}:${guardSignature}:${declarationSignature}`;
  const signatureRef = useRef(signature); signatureRef.current = signature;
  useLayoutEffect(() => { if (context && active) { context.registerTitle(route.key,scopeKey,title); navigation.setOptions({ title }); } }, [context?.model,active,route.key,scopeKey,title,navigation]);
  const runApproved = useCallback((action: () => void) => {
    // SDK58 requires the boolean and internal prevention to change in this SAME
    // handler. Re-arm after this one transition if the route remains retained.
    if (releasedRef.current) return;
    releasedRef.current = true; releaseSignature.current = signatureRef.current; setReleased(true); disableRef.current(); action();
    // Browser traversal is asynchronous (Firefox can take ~50ms). Do not re-arm
    // on the next animation frame before its real popstate has arrived.
    if (releaseTimer.current) clearTimeout(releaseTimer.current);
    releaseTimer.current = setTimeout(() => { if (mounted.current) { releasedRef.current = false; setReleased(false); } },1000);
  }, []);
  useLayoutEffect(() => {
    if (!context || !active) return;
    return context.registerBoundary({ id,key: route.key,scope: scopeKey,allow: runApproved,releasing: () => releasedRef.current });
  }, [context?.model,active,id,route.key,scopeKey,runApproved]);
  useLayoutEffect(() => { if (releasedRef.current && releaseSignature.current !== signature) { releasedRef.current = false; setReleased(false); if (releaseTimer.current) clearTimeout(releaseTimer.current); } },[signature]);
  const ownsBoundary = active && context?.boundaryOwner(route.key) === id;
  const prevent = ownsBoundary && !released && !!context?.preventing(route.key);
  disableRef.current = usePreventRemove(prevent, ({ data,repeat }) => {
    const owner = latest.current;
    if (!owner || owner.model.current.scope !== scopeKey) return;
    if (Platform.OS !== 'web' && owner.collapseAssistant(route.key)) return;
    const browserReset = Platform.OS === 'web' && data.action.type === 'RESET';
    const replay = browserReset ? owner.browserReplay(route.key) : null;
    if (browserReset && !replay) {
      // Evergreen Chromium, Safari26.2+ and Firefox147+ expose exact real-entry
      // traversal. An older browser must never replace a protected history slot.
      Alert.alert('Use the page Back control','Your changes are still here. Use Back at the top of this page to leave safely.'); return;
    }
    owner.confirm(route.key, () => {
      if (replay) {
        void replay.ready().then(() => runApproved(() => replay.traverse())).catch(() => replay.cancel());
        return;
      }
      runApproved(() => {
        if (Platform.OS !== 'web' && owner.header(route.key).custom && ['POP','GO_BACK','POP_TO','POP_TO_TOP'].includes(data.action.type)) owner.approvedBack(route.key);
        else repeat();
      });
    },true,replay?.cancel);
  });
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; if (releaseTimer.current) clearTimeout(releaseTimer.current); }; }, []);
  const customHardwareBack = !!context?.header(route.key).custom;
  useEffect(() => {
    if (Platform.OS === 'web' || !ownsBoundary || !customHardwareBack) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { latest.current?.back(route.key); return true; });
    return () => subscription.remove();
  }, [ownsBoundary,route.key,customHardwareBack,context?.version,context?.model]);
}
