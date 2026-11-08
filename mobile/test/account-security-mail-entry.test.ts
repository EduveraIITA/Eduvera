import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import React, { act } from 'react';
import ts from 'typescript';
import { accountMailLinkInput, accountMailLinks } from '../src/auth/account-mail-link';
import { accountSecurityEntryHref, verificationEmailFeedback } from '../src/auth/account-recovery';
import { ApiError } from '../src/lib/api-client';
import { nativeAuthDestination } from '../src/auth/auth-entry';
import { accountReturnTitle, safeAccountReturnTarget } from '../src/auth/account-return';

const require = createRequire(import.meta.url), origin = 'https://app2.thatcampus.com', proof = 'local-verification-proof-'.padEnd(43, 'x');
function load(path: string, dependencies: Record<string, unknown>, window: Window) {
  const source = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const exports: Record<string, unknown> = {};
  runInNewContext(source, { exports, URL, URLSearchParams, window, require: (key: string) => {
    assert.ok(key in dependencies, `Unexpected dependency ${key}`); return dependencies[key];
  } });
  return exports;
}
type Field = { label: string; value: string };
type Button = { title: string; disabled?: boolean; busy?: boolean; onPress(): void };
async function mounted(url: string, work: (h: { document: Document; fields: Map<string, Field>; buttons: Map<string, Button>;
  navigations: string[]; posts: Array<{ path: string; body: string }>; rerender(): Promise<void>; remount(): Promise<void> }) => Promise<void>, historyState?: unknown) {
  const { JSDOM } = require('jsdom'), dom = new JSDOM('<div id="root"></div>', { url });
  if (historyState !== undefined) dom.window.history.replaceState(historyState, '', url);
  const previous = { window: globalThis.window, document: globalThis.document,
    IS_REACT_ACT_ENVIRONMENT: (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const fields = new Map<string, Field>(), buttons = new Map<string, Button>(), navigations: string[] = [], posts: Array<{path:string;body:string}> = [];
  const session = { status: 'authenticated', user: { id: randomUUID(), email: 'person@example.test', email_verified: false },
    environment: { mode: 'live' }, memberships: [], publicDemo: false, onboarding: { status: 'complete' }, refresh: async () => {} };
  const Box = ({ children, title, message }: React.PropsWithChildren<{ title?: string; message?: string }>) => React.createElement('section', null, title, message, children);
  const hook = load('src/auth/use-account-mail-entry.ts', { react: React, 'expo-crypto': { randomUUID }, '../lib/api': { getApiOrigin: () => origin },
    './account-mail-link': { accountMailLinkInput, accountMailLinks } }, dom.window).useAccountMailEntry;
  const dependencies = { react: React, 'react/jsx-runtime': require('react/jsx-runtime'), 'react-native': { Text: Box },
    'expo-router': { useRouter: () => ({ replace: (href: string) => navigations.push(href) }) }, './SessionProvider': { useSession: () => session },
    './use-account-mail-entry': { useAccountMailEntry: hook }, './account-mail-link': { accountMailLinks },
    './account-recovery': { accountSecurityEntryHref, verificationEmailFeedback },
    '../lib/api': { getApiOrigin: () => origin, captureApiContext: () => ({ assertCurrent() {} }), apiFetch: async (path: string, init: RequestInit) => {
      posts.push({ path, body: String(init.body) }); assert.equal(path, '/api/v1/auth/email-verification/confirm/'); return { verified: true };
    } }, '../lib/api-client': { ApiError }, '../lib/query': { useApi: () => ({ data: { status: 'inactive', results: [] }, isPending: false, isError: false }) },
    '../ui/Alert': { Alert: { alert() {} } }, '../ui/BackNavigation': { ScreenBack: () => null, useScreenExitGuard() {},
      useCampusNavigation: (href: string) => { navigations.push(href); return { onNavigate() {}, complete() {} }; } },
    '../ui/components': { Page: Box, Section: Box, Row: Box, Loading: Box, Empty: Box, Notice: Box,
      Field: (field: Field) => { fields.set(field.label, field); return React.createElement('input', { value: field.value, readOnly: true }); },
      Button: (button: Button) => { buttons.set(button.title, button); return React.createElement('button', { disabled: button.disabled || button.busy, onClick: button.onPress }, button.title); } },
    '../ui/theme': { useTheme: () => ({ colors: {} }) }, './account-return': { accountReturnTitle, safeAccountReturnTarget },
    './auth-entry': { nativeAuthDestination }, './visit-join-policy': { visitJoinReturnTarget: () => null }, './AuthenticatorQr': { AuthenticatorQr: () => null },
  };
  const Screen = load('src/auth/AccountSecurityScreen.tsx', dependencies, dom.window).AccountSecurityScreen as React.ComponentType<{ href: string }>;
  const { createRoot } = require('react-dom/client'); let root = createRoot(dom.window.document.getElementById('root'));
  // Deliberately retain the original route prop after history.replaceState. A
  // browser/router render must not restore that stale query proof.
  const href = new URL(url).pathname + new URL(url).search;
  const render = async () => { fields.clear(); buttons.clear(); await act(async () => root.render(React.createElement(Screen, { href }))); };
  try {
    await render(); await work({ document: dom.window.document, fields, buttons, navigations, posts, rerender: render,
      remount: async () => { await act(async () => root.unmount()); root = createRoot(dom.window.document.getElementById('root')); await render(); } });
    assert.equal(dom.window.localStorage.length, 0); assert.equal(dom.window.sessionStorage.length, 0);
  } finally { await act(async () => root.unmount()); dom.window.close(); Object.assign(globalThis, previous); }
}

test('canonical browser query proof is scrubbed before navigation/forms and one successful confirmation consumes its continuation', async () => {
  await mounted(`${origin}/more/account/security?token=${proof}&from=%2Fareas`, async h => {
    assert.ok(!globalThis.window.location.href.includes(proof));
    assert.ok(!JSON.stringify(globalThis.window.history.state).includes(proof));
    const nonce = new URL(globalThis.window.location.href).searchParams.get('continue'); assert.ok(nonce);
    assert.equal(h.fields.get('Verification token')?.value, proof);
    assert.ok(h.navigations.every(href => !href.includes(proof))); assert.equal(h.posts.length, 0);
    assert.ok(h.navigations.some(href => href.includes('from=%2Fareas')));
    await h.rerender(); assert.equal(new URL(globalThis.window.location.href).searchParams.get('continue'), nonce);
    await act(async () => h.buttons.get('Confirm email')!.onPress());
    assert.deepEqual(h.posts, [{ path: '/api/v1/auth/email-verification/confirm/', body: JSON.stringify({ token: proof }) }]);
    assert.equal(accountMailLinks.read(nonce, 'email_verification', origin), null);
    await h.remount(); assert.equal(h.fields.has('Verification token'), false); assert.match(h.document.body.textContent ?? '', /original verification email/);
  }, { route: `/more/account/security?token=${proof}`, params: { token: proof }, index: 7 });
});

test('both browser security aliases keep generated fragment proofs out of navigation and retain only a volatile nonce', async () => {
  for (const path of ['/more/account/security', '/account/security']) await mounted(`${origin}${path}#token=${proof}`, async h => {
    assert.equal(h.fields.get('Verification token')?.value, proof); assert.equal(globalThis.window.location.hash, '');
    assert.ok(!globalThis.window.location.href.includes(proof)); assert.ok(h.navigations.every(href => !href.includes(proof)));
    const current = globalThis.window.location.href; await h.rerender(); assert.equal(globalThis.window.location.href, current);
    assert.deepEqual(globalThis.window.history.state, { index: 7, key: 'safe-router-entry' });
  }, { index: 7, key: 'safe-router-entry' });
});

test('canonical duplicate/mixed proof values are scrubbed and never choose a token or dispatch', async () => {
  for (const suffix of [`?token=${proof}&token=${proof}`, `?token=${proof}#token=${proof}`, `?continue=${randomUUID()}#token=${proof}`])
    await mounted(`${origin}/more/account/security${suffix}`, async h => {
      assert.ok(!globalThis.window.location.href.includes(proof)); assert.equal(h.fields.has('Verification token'), false); assert.equal(h.posts.length, 0);
    });
});

test('canonical entry refuses foreign browser origins and wrong-purpose or cold continuations', async () => {
  const wrong = accountMailLinks.retain(proof, 'password_reset', origin, randomUUID);
  for (const url of [`https://foreign.example/more/account/security?token=${proof}`, `${origin}/more/account/security?continue=${wrong.id}`, `${origin}/more/account/security?continue=${randomUUID()}`])
    await mounted(url, async h => { assert.equal(h.fields.has('Verification token'), false); assert.equal(h.posts.length, 0); assert.ok(h.navigations.every(href => !href.includes(proof))); });
});
