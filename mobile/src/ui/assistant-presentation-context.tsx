import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { AppState, Platform, useWindowDimensions } from 'react-native';
import { useRootNavigationState } from 'expo-router';
import { useSession } from '../auth/SessionProvider';
import { assistantEntryAvailable, assistantPerspective } from '../lib/assistant-access';
import { useApi } from '../lib/query';
import { ApiError, captureApiContext } from '../lib/api';
import { canonicalNativeHref } from '../lib/navigation';
import { focusedCampusRoute, campusHrefForRoute, isFocusedCampusAncestor, type CampusNavigationState } from '../lib/back-policy';
import { assistantPresentationPermitted, assistantPresentationUnavailable } from '../lib/assistant-presentation-policy';
import { currentAssistantOverlay, assertAssistantOverlayLease, type AssistantOverlayEntry } from '../lib/assistant-overlay';
import { assistantLayout } from '../lib/assistant-layout';
import { ASSISTANT_TAB_HREF } from '../lib/campus-tabs';

export interface AssistantFrame { width: number; height: number }
type Presentation = {
  active: boolean; mounted: boolean; expanded: boolean; mode: 'compact' | 'fullscreen' | 'split'; splitAxis: 'horizontal' | 'vertical' | null; entryToken: string; requestRevision: number; href: string; canonical: boolean; frame: AssistantFrame;
  open(caller: string,scope: string,href?: string,forceIntent?: boolean): void; setExpanded(caller: string,scope: string,value: boolean,expectedToken?: string): void; close(caller: string,scope: string,expectedToken?: string): void;
  captureOperation(expectedToken?: string): () => void; setFrame(frame: AssistantFrame): void;
};
const unavailable = () => { throw new Error('Open Assistant in the current campus before continuing.'); };
const Context = createContext<Presentation>({ active: false,mounted: false,expanded: false,mode: 'compact',splitAxis: null,entryToken: '',requestRevision: 0,href: ASSISTANT_TAB_HREF,canonical: false,frame: { width: 0,height: 0 },open() {},setExpanded() {},close() {},captureOperation: unavailable,setFrame() {} });
/** One body stays mounted above the actual retained workspace. Entries only label
 * its visibility; Expo remains the sole owner of route chronology and keys. */
export function AssistantPresentationProvider({ children }: React.PropsWithChildren) {
  const window = useWindowDimensions(), tablet = Platform.OS === 'ios' && Platform.isPad === true;
  const session = useSession(), tree = useRootNavigationState() as CampusNavigationState | undefined, focused = focusedCampusRoute(tree);
  const href = focused && tree ? campusHrefForRoute(tree,focused.key) : undefined;
  const focus = focused && href ? { key: focused.key,scope: session.scopeKey,href: canonicalNativeHref(href) } : undefined;
  const [state,setState] = useState<{ scope: string; entries: ReadonlyMap<string,AssistantOverlayEntry>; pinnedKey: string | null; mounted: boolean; href: string; requestRevision: number }>({ scope: session.scopeKey,entries: new Map(),pinnedKey: null,mounted: false,requestRevision: 0,href: ASSISTANT_TAB_HREF });
  const [frame,setFrame] = useState<AssistantFrame>({ width: 0,height: 0 });
  const entries = state.scope === session.scopeKey ? state.entries : new Map<string,AssistantOverlayEntry>(), entry = currentAssistantOverlay(entries,focus,state.pinnedKey,tablet);
  const perspective = assistantPerspective(session.user,session.memberships,session.schoolId), eligible = assistantEntryAvailable(session.environment,true,perspective);
  const preference = useApi<unknown>(eligible ? '/api/v1/auth/pro-features/' : null);
  const permitted = assistantPresentationPermitted(eligible,preference.data,preference.error instanceof ApiError ? preference.error.status : undefined);
  const denied = assistantPresentationUnavailable(eligible,preference.data,preference.error instanceof ApiError ? preference.error.status : undefined);
  const retired = denied && (state.pinnedKey !== null || !entry?.canonical), active = !!entry?.open && !retired;
  const binding = JSON.stringify([session.scopeKey,focus?.key,focus?.href]), navigationEpoch = useRef({ binding,revision: 0 });
  if (navigationEpoch.current.binding !== binding) navigationEpoch.current = { binding,revision: navigationEpoch.current.revision + 1 };
  const expanded = active && !!entry?.expanded && permitted, layout = assistantLayout({ ...window,isPad: tablet,expanded });
  // App-pane navigation keeps the chat mounted, but invalidates every prepared
  // callback. Returning to an old app key cannot revive its earlier lease.
  const baseToken = entry?.open ? JSON.stringify([entry.scope,entry.href,entry.nonce]) : '', token = active && baseToken ? `${baseToken}:${navigationEpoch.current.revision}` : '';
  const current = useRef({ session,tree,focus,active,token,permitted,entry }); current.current = { session,tree,focus,active,token,permitted,entry };
  const sequence = useRef(0);
  useEffect(() => {
    if (!retired || !entry?.open) return;
    setState(previous => ({ ...previous,pinnedKey: null,entries: new Map([...previous.entries,[entry.key,{ ...entry,open: false,nonce: ++sequence.current }]]) }));
  },[retired,entry?.key,entry?.nonce,entry?.open]);
  useEffect(() => {
    if (!tree) return;
    const keys = new Set<string>(); const visit = (value: CampusNavigationState | undefined) => { for (const route of value?.routes ?? []) { keys.add(route.key); visit(route.state); } }; visit(tree);
    setState(previous => {
      if (previous.scope !== session.scopeKey) return { scope: session.scopeKey,entries: new Map(),pinnedKey: null,mounted: false,requestRevision: 0,href: ASSISTANT_TAB_HREF };
      const retained = new Map([...previous.entries].filter(([key]) => keys.has(key) || key === previous.pinnedKey));
      return retained.size === previous.entries.size ? previous : { ...previous,entries: retained };
    });
  },[tree,session.scopeKey]);
  function allowed(caller: string,scope: string) {
    const value = current.current;
    if (!value.focus || !value.session.ready || value.session.status !== 'authenticated' || scope !== value.session.scopeKey || !isFocusedCampusAncestor(value.tree,caller)) return null;
    try { captureApiContext().assertCurrent(); } catch { return null; }
    return value;
  }
  const value: Presentation = { active,mounted: state.scope === session.scopeKey && state.mounted,expanded,mode: layout.mode,splitAxis: layout.axis,entryToken: token,requestRevision: state.requestRevision,href: state.scope === session.scopeKey ? state.href : ASSISTANT_TAB_HREF,canonical: !!entry?.canonical,frame,
    open(caller,scope,requested,forceIntent = false) {
      const value = allowed(caller,scope); if (!value?.focus || requested === undefined && !value.permitted) return;
      const canonical = requested !== undefined, nextHref = canonical ? canonicalNativeHref(requested) : state.href;
      if (!nextHref.startsWith(ASSISTANT_TAB_HREF) || ![undefined,'?','#'].includes(nextHref[ASSISTANT_TAB_HREF.length])) return;
      if (!forceIntent && value.active && value.entry?.href === nextHref && value.entry.canonical === canonical) return;
      current.current = { ...value,active: false,token: '' };
      const next: AssistantOverlayEntry = { key: value.focus.key,scope,sourceHref: value.focus.href,href: nextHref,nonce: ++sequence.current,open: true,expanded: canonical && value.permitted,canonical };
      setState(previous => ({ scope,entries: new Map([...(previous.scope === scope ? previous.entries : []),[next.key,next]]),pinnedKey: !next.expanded || tablet ? next.key : null,mounted: true,requestRevision: canonical ? next.nonce : previous.requestRevision,href: nextHref }));
    },
    setExpanded(caller,scope,expanded,expectedToken) {
      const value = allowed(caller,scope); if (!value?.entry || !value.active || expectedToken !== undefined && expectedToken !== value.token || expanded && !value.permitted) return;
      if (!value.focus) return;
      const next = { ...value.entry,expanded,...(!expanded ? { key: value.focus.key,sourceHref: value.focus.href,canonical: value.entry.canonical && value.focus.href.split(/[?#]/)[0] === ASSISTANT_TAB_HREF } : {}) };
      setState(previous => {
        const entries = new Map(previous.entries);
        if (next.key !== value.entry!.key) entries.set(value.entry!.key,{ ...value.entry!,open: false });
        entries.set(next.key,next);
        return { ...previous,entries,pinnedKey: !expanded || tablet ? next.key : null };
      });
    },
    close(caller,scope,expectedToken) {
      const value = allowed(caller,scope); if (!value?.entry || !value.active || expectedToken !== undefined && expectedToken !== value.token) return;
      // Closing is lossless: the body remains mounted and no router entry moves.
      current.current = { ...value,active: false,token: '' };
      setState(previous => ({ ...previous,pinnedKey: null,entries: new Map([...previous.entries,[value.entry!.key,{ ...value.entry!,open: false,nonce: ++sequence.current }]]) }));
    },
    captureOperation(expectedToken) {
      const expected = expectedToken ?? current.current.token, transport = captureApiContext();
      const assert = assertAssistantOverlayLease(expected,() => ({ token: current.current.token,active: current.current.active,ready: current.current.session.ready && current.current.session.status === 'authenticated' && AppState.currentState === 'active' }));
      return () => { assert(); transport.assertCurrent(); };
    },
    setFrame(next) { setFrame(previous => previous.width === next.width && previous.height === next.height ? previous : next); },
  };
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useAssistantPresentationState() { return useContext(Context); }
