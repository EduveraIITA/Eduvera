import { useEffect, useLayoutEffect, useRef } from 'react';
import { NavigationType, useLocation, useNavigationType } from 'react-router-dom';
import { browserHistoryIndex, rememberPortalLocation, resetRememberedPortalHistory } from './portalHistory';

type Position = { x: number; y: number };
type Visit = { key: string; href: string; pathname: string; position: Position };
const maxEntries = 200;
const restoreWindowMs = 8_000;
const scrollKeys = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ', 'Spacebar']);
const detailParams = ['assessment', 'assessment_id', 'publication_id', 'report_batch_id', 'batch', 'scheme', 'policy', 'edit', 'create', 'mode', 'invoice', 'case', 'import', 'rule', 'report', 'item', 'assignment', 'student', 'guardian', 'loan_id', 'question_id', 'stay_id', 'room_id', 'repair_id', 'offer_id', 'session_id', 'service_id', 'issue_id', 'plan_id', 'series_id', 'register_id', 'occurrence_id', 'request_id', 'settings'];

function position(): Position { return { x: window.scrollX || 0, y: window.scrollY || 0 }; }
function entryKey(key: string, href: string) { return `${key}:${href}`; }
function remember(map: Map<string, Position>, key: string, value: Position) {
  map.delete(key); map.set(key, value);
  if (map.size > maxEntries) map.delete(map.keys().next().value!);
}
function detailIdentity(href: string) {
  const url = new URL(href, window.location.origin);
  return detailParams.map(key => `${key}:${url.searchParams.get(key) ?? ''}`).join('|');
}
function returnsToQueryParent(from: Visit | null, pathname: string, href: string) {
  if (!from || from.pathname !== pathname) return false;
  const previous = new URL(from.href, window.location.origin).searchParams;
  const next = new URL(href, window.location.origin).searchParams;
  // Domain Back controls can remove a nested record selector with a PUSH. Only
  // reuse a saved *complete* destination URL when remaining selectors agree.
  return detailParams.some(param => previous.has(param) && !next.has(param))
    && detailParams.every(param => !next.has(param) || next.get(param) === previous.get(param));
}

/** Commits with Routes, so a lazy route cannot restore against the old screen. */
export function RouteScrollCommitMarker() {
  const location = useLocation();
  return <span hidden data-route-scroll-entry={entryKey(location.key, location.pathname + location.search + location.hash)} />;
}

/** In-memory UI offsets only: never campus records, persistent storage or authority. */
export function RouteScrollRestoration({ scopeKey, requireCommitMarker = false }: { scopeKey: string | null; requireCommitMarker?: boolean }) {
  const location = useLocation();
  const navigation = useNavigationType();
  const href = location.pathname + location.search + location.hash;
  const key = entryKey(location.key, href);
  const memory = useRef({ scope: scopeKey, entries: new Map<string, Position>(), urls: new Map<string, Position>() });
  const active = useRef<Visit | null>(null);
  const pending = useRef(false);
  const cancel = useRef<() => void>(() => undefined);
  const returning = useRef(false);

  const save = () => {
    if (!scopeKey || !active.current) return;
    remember(memory.current.entries, active.current.key, active.current.position);
    remember(memory.current.urls, active.current.href, active.current.position);
  };

  useEffect(() => {
    const previous = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
    return () => { window.history.scrollRestoration = previous; };
  }, []);

  useLayoutEffect(() => {
    const scroll = () => {
      if (active.current && !pending.current) active.current.position = position();
    };
    const beforeNavigation = (event?: Event) => {
      if (active.current && !pending.current) active.current.position = position();
      save();
      if (event?.type === 'click') {
        const element = event.target instanceof Element ? event.target : null;
        returning.current = Boolean(element?.closest('.portal-page-title__back,button[aria-label="Go back"]'));
      }
    };
    const userIntent = (event: Event) => {
      if (event instanceof KeyboardEvent && !scrollKeys.has(event.key)) return;
      cancel.current();
      if (active.current) active.current.position = position();
    };
    window.addEventListener('scroll', scroll, { passive: true });
    window.addEventListener('popstate', beforeNavigation, true);
    window.addEventListener('pagehide', beforeNavigation);
    document.addEventListener('click', beforeNavigation, true);
    window.addEventListener('wheel', userIntent, { passive: true });
    window.addEventListener('touchstart', userIntent, { passive: true });
    window.addEventListener('pointerdown', userIntent, { passive: true });
    window.addEventListener('keydown', userIntent);
    return () => {
      window.removeEventListener('scroll', scroll);
      window.removeEventListener('popstate', beforeNavigation, true);
      window.removeEventListener('pagehide', beforeNavigation);
      document.removeEventListener('click', beforeNavigation, true);
      window.removeEventListener('wheel', userIntent);
      window.removeEventListener('touchstart', userIntent);
      window.removeEventListener('pointerdown', userIntent);
      window.removeEventListener('keydown', userIntent);
    };
    // Listeners must use the active authenticated scope, not a departed account.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey]);

  useLayoutEffect(() => {
    cancel.current();
    const scopeChanged = memory.current.scope !== scopeKey || active.current === null;
    if (scopeChanged) {
      memory.current = { scope: scopeKey, entries: new Map(), urls: new Map() };
      active.current = null;
      resetRememberedPortalHistory();
    } else save();
    const previous = active.current;
    rememberPortalLocation(browserHistoryIndex(), href);
    const queryReturn = returnsToQueryParent(previous, location.pathname, href);
    const saved = scopeKey && !scopeChanged
      ? navigation === NavigationType.Pop ? memory.current.entries.get(key)
        : navigation === NavigationType.Replace || returning.current || queryReturn ? memory.current.urls.get(href) : undefined
      : undefined;
    const preserve = !scopeChanged && !saved && previous?.pathname === location.pathname
      && navigation !== NavigationType.Pop && !returning.current && !location.hash
      && detailIdentity(previous.href) === detailIdentity(href);
    returning.current = false;
    const target = saved ?? (preserve ? position() : { x: 0, y: 0 });
    active.current = { key, href, pathname: location.pathname, position: target };
    if (preserve) return;

    pending.current = true;
    let frame = 0;
    let stableFrames = 0;
    let stopped = false;
    let mutation: MutationObserver | undefined;
    let resize: ResizeObserver | undefined;
    const stop = () => {
      if (stopped) return;
      stopped = true; pending.current = false;
      cancelAnimationFrame(frame); mutation?.disconnect(); resize?.disconnect(); clearTimeout(timeout);
    };
    const committed = () => !requireCommitMarker || [...document.querySelectorAll('[data-route-scroll-entry]')]
      .some(element => element.getAttribute('data-route-scroll-entry') === key);
    const attempt = () => {
      frame = 0;
      if (stopped || !committed()) return;
      if (target.y > 0 && document.querySelector('.route-loader[aria-busy="true"],.responsibility-workspace[aria-busy="true"]')) return;
      if (location.hash && !saved) {
        let id: string;
        try { id = decodeURIComponent(location.hash.slice(1)); } catch { id = location.hash.slice(1); }
        const anchor = document.getElementById(id);
        if (!anchor) return;
        anchor.scrollIntoView({ behavior: 'instant' });
        if (active.current) active.current.position = position();
        stop(); return;
      }
      window.scrollTo({ left: target.x, top: target.y, behavior: 'instant' });
      const reached = Math.abs(window.scrollY - target.y) <= 1 && Math.abs(window.scrollX - target.x) <= 1;
      if (reached) {
        stableFrames += 1;
        if (stableFrames >= 2) { if (active.current) active.current.position = position(); stop(); return; }
        frame = requestAnimationFrame(attempt);
      } else stableFrames = 0;
    };
    const schedule = () => { if (!stopped && !frame) frame = requestAnimationFrame(attempt); };
    const timeout = setTimeout(() => { stop(); if (active.current) active.current.position = position(); }, restoreWindowMs);
    cancel.current = stop;
    if (typeof MutationObserver !== 'undefined') {
      mutation = new MutationObserver(schedule);
      mutation.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
    }
    if (typeof ResizeObserver !== 'undefined') {
      resize = new ResizeObserver(schedule); resize.observe(document.documentElement); resize.observe(document.body);
    }
    schedule();
    return stop;
    // A location entry or authoritative scope change is the restoration boundary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, scopeKey, requireCommitMarker]);

  return null;
}
