import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import React, { act } from 'react';
import ts from 'typescript';
import { getRoutes } from 'expo-router/build/getRoutesCore';
import { getReactNavigationConfig } from 'expo-router/build/getReactNavigationConfig';
import { getStateFromPath } from 'expo-router/build/fork/getStateFromPath';
import type { RequireContext } from 'expo-router/build/types';
import { accountSecurityEntryHref, confirmedPasswordReset, guardedAccountRecoveryApi, passwordResetInput, passwordResetRequestFeedback, verificationEmailFeedback, type AccountRecoveryOperation } from '../src/auth/account-recovery';
import { accountMailLinks } from '../src/auth/account-mail-link';
import { nativeAuthDestination } from '../src/auth/auth-entry';
import { safeAccountReturnTarget } from '../src/auth/account-return';
import { createPublicFormLease } from '../src/auth/public-form-operation';
import { browserAuthMutation } from '../src/auth/web-auth-mutation';
import { ApiError } from '../src/lib/api-client';
import type { SessionState } from '../src/auth/session-types';

const require = createRequire(import.meta.url), root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const proof = 'synthetic-proof-'.padEnd(64, '0'), password = 'Synthetic-pass-123!';
const session: SessionState = { status: 'authenticated', user: { id: 'actor', email: 'person@example.test', username: 'person', display_name: 'Person', first_name: 'Person', last_name: '', email_verified: false }, memberships: [], environment: { mode: 'live' }, error: null, setupRequired: true };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function load(file: string, dependencies: Record<string, unknown>) {
  const source = path.join(root, file), code = ts.transpileModule(readFileSync(source, 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const exports: Record<string, unknown> = {};
  runInNewContext(code, { exports, __DEV__: false, Error, URL, URLSearchParams, setTimeout, clearTimeout, require(name: string) { if (name.endsWith('.png')) return 1; if (!(name in dependencies)) throw new Error(`Unexpected auth dependency ${name}`); return dependencies[name]; } }, { filename: source, timeout: 1000 });
  return exports;
}

test('verification email adapter keeps its exact proof and safe authorized continuation through sign-in', () => {
  const target = accountSecurityEntryHref({ token: proof, from: '/onboarding/start', untrusted: 'ignored' });
  assert.equal(target, `/more/account/security?token=${proof}&from=%2Fonboarding%2Fstart`);
  assert.equal(nativeAuthDestination(session, target!), target);
  assert.equal(nativeAuthDestination({ ...session, user: { ...session.user!, email_verified: true } }, target!), target);
  assert.equal(accountSecurityEntryHref({ from: '//foreign.test', next: '/more/account/security' }), '/more/account/security');
  for (const params of [{ token: [proof, proof] }, { token: 'short' }, { token: proof + '\nforged' }, { from: ['/today', '/work'] }]) assert.equal(accountSecurityEntryHref(params), null);
});

test('the installed Expo SDK resolves current email and tokenless reset URLs on all three platforms', () => {
  const app = path.join(root, 'app'), files: string[] = [];
  function walk(directory: string, prefix = './') { for (const item of readdirSync(directory, { withFileTypes: true })) { if (item.isDirectory()) walk(path.join(directory, item.name), prefix + item.name + '/'); else if (/\.[tj]sx?$/.test(item.name)) files.push(prefix + item.name); } }
  walk(app);
  const context = Object.assign(() => ({ default() {} }), { keys: () => files, id: 'current-auth-port-routes', resolve: (name: string) => name }) as RequireContext;
  for (const platform of ['ios', 'android', 'web']) {
    const routes = getRoutes(context, { platform, platformRoutes: true, skipGenerated: true, ignoreEntryPoints: true, getSystemRoute: () => { throw new Error('Unexpected generated route'); } }); assert.ok(routes);
    const config = { screens: { __root: { path: '', ...getReactNavigationConfig(routes, true) } } };
    for (const [href, name] of [[`/account/security?token=${proof}&from=%2Fonboarding%2Fstart`, 'account/security'], ['/reset-password', 'reset-password']]) {
      const state = getStateFromPath(href!, config); assert.ok(state, platform);
      let leaf = state.routes[state.index ?? 0]!; while (leaf.state) leaf = leaf.state.routes[leaf.state.index ?? 0]!;
      assert.equal(leaf.name, name, platform);
      if (name === 'account/security') assert.equal((leaf.params as { token?: string }).token, proof);
    }
  }
});

test('reset validation preserves the exact password, trims only its proof, and requires confirmation', () => {
  assert.deepEqual(passwordResetInput(` ${proof} `, password, password), { token: proof, password });
  for (const values of [['short', password, password], [proof, password, 'different'], [proof, 'short', 'short'], [proof, 'x'.repeat(129), 'x'.repeat(129)]]) assert.throws(() => passwordResetInput(values[0]!, values[1]!, values[2]!));
  confirmedPasswordReset({ reset: true });
  for (const value of [null, {}, { reset: false }, { reset: 'true' }]) assert.throws(() => confirmedPasswordReset(value));
});

test('the actual reset route opens the password form only with one captured proof', () => {
  let params: Record<string, unknown> = {};
  const LoginScreen = Symbol('LoginScreen'), Page = Symbol('Page'), exports = load('app/reset-password.tsx', { 'react/jsx-runtime': require('react/jsx-runtime'), 'expo-router': { useLocalSearchParams: () => params, useRouter: () => ({ replace() {} }) }, '../src/auth/LoginScreen': { LoginScreen }, '../src/auth/use-account-mail-entry': { useAccountMailEntry: (_purpose: string, value: Record<string,unknown>) => ({ ready: true, token: typeof value.token === 'string' ? value.token : undefined }) }, '../src/ui/components': { Empty: Symbol('Empty'), Loading: Symbol('Loading'), Page } });
  const route = exports.default as () => React.ReactElement<{ resetToken?: string }>;
  assert.equal(route().type, Page);
  params = { token: proof }; assert.equal(route().type, LoginScreen); assert.equal(route().props.resetToken, proof);
  params = { token: [proof, 'different-proof'] }; assert.equal(route().type, Page);
});

test('browser CSRF preparation cannot dispatch a password reset after account, world, origin or form changed', async () => {
  for (const changed of ['account', 'world', 'origin', 'token', 'password']) {
    const lease = createPublicFormLease({ identity: 'original', mounted: true, focused: true, foreground: true }), csrf = deferred<void>(); let posts = 0;
    const api = guardedAccountRecoveryApi({ async apiFetch<T>(_path: string, init?: RequestInit) { if (!init) { await csrf.promise; return {} as T; } posts++; return { reset: true } as T; } }, { assertCurrent: lease.capture() });
    const result = browserAuthMutation(api, '/api/v1/auth/password-reset/confirm/', { token: proof, password });
    lease.update({ identity: changed, mounted: true, focused: true, foreground: true }); csrf.resolve();
    await assert.rejects(result); assert.equal(posts, 0, changed);
  }
});

test('a normal browser reset keeps exact CSRF retry semantics and rejects late response delivery', async () => {
  let bootstraps = 0, posts = 0, dispatched = 0;
  const api = guardedAccountRecoveryApi({ async apiFetch<T>(_path: string, init?: RequestInit) { if (!init) { bootstraps++; return {} as T; } posts++; if (posts === 1) throw new ApiError('CSRF token required', 403); return { reset: true } as T; } }, { assertCurrent() {}, onDispatch() { dispatched++; } });
  confirmedPasswordReset(await browserAuthMutation(api, '/api/v1/auth/password-reset/confirm/', { token: proof, password }));
  assert.equal(bootstraps, 2); assert.equal(posts, 2); assert.equal(dispatched, 2);
  const late = deferred<unknown>(), lease = createPublicFormLease({ identity: 'original', mounted: true, focused: true, foreground: true });
  const request = guardedAccountRecoveryApi({ apiFetch: async <T>() => await late.promise as T }, { assertCurrent: lease.capture() }).apiFetch('/reset', { method: 'POST' });
  lease.update({ identity: 'new account', mounted: true, focused: true, foreground: true }); late.resolve({ reset: true }); await assert.rejects(request);
});

type FieldProps = { label: string; value: string; onChangeText(value: string): void; editable?: boolean };
type ButtonProps = { title: string; disabled?: boolean; busy?: boolean; onPress(): void };
type Harness = { fields: Map<string, FieldProps>; buttons: Map<string, ButtonProps>; text(): string; fill(label: string, value: string): Promise<void>; press(title: string): Promise<void>; paths: string[]; refreshes(): number; resetProof(): string | null; rebind(): Promise<void>; scrollProps(): Record<string, any>; keyboardAvoiderCount(): number };
async function mountedReset(run: (h: Harness) => Promise<void>, confirm: (token: string, password: string, operation: AccountRecoveryOperation) => Promise<unknown> = async (_token, _password, operation) => { operation.assertCurrent(); operation.onDispatch?.(); return { reset: true }; }, options: { platform?: 'ios' | 'android' | 'web'; mode?: 'login' | 'register' | 'recovery' | 'reset'; requestReset?: () => Promise<unknown> } = {}) {
  const { JSDOM } = require('jsdom') as { JSDOM: new (html: string) => { window: Window & typeof globalThis } }, dom = new JSDOM('<div id="root"></div>');
  const previous = { window: globalThis.window, document: globalThis.document, IS_REACT_ACT_ENVIRONMENT: (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const { createRoot } = require('react-dom/client') as { createRoot(node: Element): { render(node: React.ReactNode): void; unmount(): void } };
  const fields = new Map<string, FieldProps>(), buttons = new Map<string, ButtonProps>(), paths: string[] = []; let scope = 'anonymous:live', refreshes = 0, scrollProps: Record<string, any> = {}, keyboardAvoiderCount = 0;
  const Container = ({ children }: React.PropsWithChildren) => React.createElement('div', null, children);
  const dependencies: Record<string, unknown> = {
    react: React, 'react/jsx-runtime': require('react/jsx-runtime'),
    'react-native': { AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) }, Image: () => null, KeyboardAvoidingView: ({ children }: React.PropsWithChildren) => { keyboardAvoiderCount++; return React.createElement(Container, null, children); }, ScrollView: (props: React.PropsWithChildren<Record<string, any>>) => { scrollProps = props; return React.createElement(Container, null, props.children); }, View: Container, Text: Container, Pressable: ({ children, onPress, disabled }: React.PropsWithChildren<{ onPress(): void; disabled?: boolean }>) => React.createElement('button', { onClick: onPress, disabled }, children), Platform: { OS: options.platform ?? 'web' }, StyleSheet: { create: (value: unknown) => value } },
    'react-native-safe-area-context': { SafeAreaView: Container }, './SessionProvider': { useSession: () => ({ status: 'anonymous', scopeKey: scope, error: null, refresh: async () => { refreshes++; } }) },
    '../ui/components': { Field: (props: FieldProps) => { fields.set(props.label, props); return React.createElement('label', null, props.label); }, Button: (props: ButtonProps) => { buttons.set(props.title, props); return React.createElement('button', { disabled: props.disabled || props.busy, onClick: props.onPress }, props.title); }, Notice: ({ message }: { message: string }) => React.createElement('p', null, message) },
    '../ui/theme': { useTheme: () => ({ colors: {}, dark: false }) }, '../lib/api': { getApiOrigin: () => 'https://campus.example.test', setApiOrigin() {} }, '../lib/api-client': { ApiError },
    './account-ceremonies': { confirmPasswordReset: confirm, requestPasswordReset: options.requestReset ?? (async () => ({ accepted: true })) }, './account-recovery': { accountActionToken: (value: string) => value.trim().length >= 32, confirmedPasswordReset, passwordResetInput, passwordResetRequestFeedback }, './public-form-operation': { createPublicFormLease }, './account-return': { safeAccountReturnTarget },
    './account-mail-link': { accountMailLinks }, '../ui/Glass': { Glass: Container }, './GoogleSignInButton': { GoogleSignInButton: () => null },
    'expo-router': { useIsFocused: () => true, useLocalSearchParams: () => ({}), usePathname: () => '/reset-password', useRouter: () => ({ replace: (href: string) => paths.push(href), push: (href: string) => paths.push(href), setParams() {} }) },
  };
  const exports = load('src/auth/LoginScreen.tsx', dependencies), Screen = exports.LoginScreen as React.ComponentType<{ initialMode?: 'login' | 'register' | 'recovery'; resetToken?: string; resetContinuation?: string }>, renderer = createRoot(dom.window.document.getElementById('root')!);
  const mode = options.mode ?? 'reset';
  const continuation = mode === 'reset' ? accountMailLinks.retain(proof, 'password_reset', 'https://campus.example.test', require('node:crypto').randomUUID).id : undefined;
  const props = mode === 'reset' ? { resetToken: proof, resetContinuation: continuation } : { initialMode: mode };
  const render = async () => { fields.clear(); buttons.clear(); await act(async () => renderer.render(React.createElement(Screen, props))); };
  try {
    await render();
    await run({ fields, buttons, paths, refreshes: () => refreshes, resetProof: () => accountMailLinks.read(continuation, 'password_reset', 'https://campus.example.test'), scrollProps: () => scrollProps, keyboardAvoiderCount: () => keyboardAvoiderCount, text: () => dom.window.document.body.textContent ?? '', fill: async (label, value) => { const field = fields.get(label); assert.ok(field, label); assert.notEqual(field.editable, false, label); await act(async () => field.onChangeText(value)); }, press: async title => { const button = buttons.get(title); if (button) { assert.notEqual(button.disabled, true, title); await act(async () => button.onPress()); } else { const link = [...dom.window.document.querySelectorAll('button')].find(node => node.textContent === title); assert.ok(link, title); assert.equal(link.disabled, false); await act(async () => link.click()); } }, rebind: async () => { scope = 'different-account:simulation'; await render(); } });
  } finally { if (continuation) accountMailLinks.remove(continuation); await act(async () => renderer.unmount()); Object.assign(globalThis, previous); dom.window.close(); }
}

test('every account form scrolls within its safe viewport and uses one native keyboard owner on iPhone', async () => {
  for (const mode of ['login', 'register', 'recovery', 'reset'] as const) {
    await mountedReset(async h => {
      const scroll = h.scrollProps();
      assert.equal(scroll.style.flex, 1); assert.equal(scroll.style.minHeight, 0);
      assert.equal(scroll.contentContainerStyle.flexGrow, 1);
      assert.equal(scroll.contentContainerStyle.flex, undefined, 'Long forms retain their full scrollable content height');
      assert.equal(scroll.automaticallyAdjustKeyboardInsets, true);
      assert.equal(scroll.contentInsetAdjustmentBehavior, 'never', 'The outer safe area already reserves system edges');
      assert.equal(scroll.keyboardDismissMode, 'interactive');
      assert.equal(h.keyboardAvoiderCount(), 0, 'A parent-relative keyboard frame must not compete with native window-coordinate adjustment');
      if (mode === 'login') {
        assert.match(h.text(), /Explore the sample campus/);
        await h.press('Explore the sample campus'); assert.equal(h.paths.at(-1), '/demo');
      }
    }, undefined, { platform: 'ios', mode });
  }
});

test('mounted reset shows only password fields and submits the original hidden proof for matching passwords', async () => {
  const requests: Array<{ token: string; password: string }> = [];
  await mountedReset(async h => {
    assert.deepEqual([...h.fields.keys()], ['New password', 'Confirm password']);
    assert.ok(!h.text().includes(proof)); assert.equal(h.resetProof(), proof);
    assert.ok(h.text().includes('Request a new reset link')); await h.press('Request a new reset link'); assert.deepEqual(h.paths, ['/forgot-password']);
    await h.fill('New password', password); await h.fill('Confirm password', 'Different-password-123!'); await h.press('Save new password');
    assert.equal(requests.length, 0); assert.match(h.text(), /passwords do not match/);
    await h.fill('Confirm password', password); await h.press('Save new password');
    assert.deepEqual(requests, [{ token: proof, password }]); assert.match(h.text(), /Previous sessions are signed out/); assert.equal(h.resetProof(), null);
    await h.press('Sign in'); assert.equal(h.paths.at(-1), '/login'); assert.equal(h.refreshes(), 1, 'recheck revoked current sessions before canonical sign-in, not a second inline login owner');
  }, async (token, value, operation) => { operation.assertCurrent(); operation.onDispatch?.(); requests.push({ token, password: value }); return { reset: true }; });
});

test('mounted reset refuses a late success from a changed account and retains an unconfirmed reset without replay', async () => {
  const response = deferred<unknown>(); let posts = 0, request: Promise<void> | undefined;
  await mountedReset(async h => {
    await h.fill('New password', password); await h.fill('Confirm password', password);
    await act(async () => { request = Promise.resolve(h.buttons.get('Save new password')!.onPress()); });
    assert.equal(posts, 1); await h.rebind(); await act(async () => { response.resolve({ reset: true }); await response.promise; });
    assert.doesNotMatch(h.text(), /Password updated/); assert.equal(posts, 1); await request;
  }, async (_token, _password, operation) => { operation.assertCurrent(); operation.onDispatch?.(); posts++; return response.promise; });
  await mountedReset(async h => {
    await h.fill('New password', password); await h.fill('Confirm password', password); await h.press('Save new password');
    assert.match(h.text(), /result is unconfirmed/); assert.equal(h.buttons.get('Save new password')?.disabled, true); assert.ok(h.text().includes('Request a new reset link'));
  }, async (_token, _password, operation) => { operation.assertCurrent(); operation.onDispatch?.(); throw new ApiError('Unconfirmed reset', 500); });
});

test('actual verification adapter redirects anonymously through sign-in and directly to the same security owner after authentication', () => {
  let status = 'anonymous', params: Record<string, unknown> = { token: proof, from: '/onboarding/start' };
  const Redirect = Symbol('Redirect'), Empty = Symbol('Empty'), Page = Symbol('Page');
  const exports = load('src/auth/AccountSecurityEntryScreen.tsx', { 'react/jsx-runtime': require('react/jsx-runtime'), 'expo-router': { Redirect, useLocalSearchParams: () => params, useRouter: () => ({ replace() {} }) }, './SessionProvider': { useSession: () => ({ status }) }, './account-recovery': { accountSecurityEntryHref }, './use-account-mail-entry': { useAccountMailEntry: (_purpose: string, value: Record<string,unknown>) => ({ ready: true, invalid: Array.isArray(value.token), continuation: typeof value.token === 'string' ? '00000000-0000-4000-8000-000000000001' : undefined }) }, '../ui/components': { Button: Symbol('Button'), Empty, Loading: Symbol('Loading'), Page } });
  const Screen = exports.AccountSecurityEntryScreen as () => React.ReactElement<{ href?: string }>;
  const target = accountSecurityEntryHref({ ...params, token: undefined, continue: '00000000-0000-4000-8000-000000000001' })!; let node = Screen(); assert.equal(node.type, Redirect); assert.equal(node.props.href, `/login?next=${encodeURIComponent(target)}`);
  status = 'authenticated'; node = Screen(); assert.equal(node.type, Redirect); assert.equal(node.props.href, target);
  status = 'loading'; assert.equal(Screen().type, Page);
  params = { token: [proof, proof] }; assert.equal(Screen().type, Page);
});


test('email feedback distinguishes disabled delivery and real development proof without promising a missing token', () => {
  assert.equal(verificationEmailFeedback({ delivery: 'manual' }).tone, 'warning');
  assert.match(verificationEmailFeedback({ delivery: 'manual' }).message, /currently unavailable/);
  assert.doesNotMatch(verificationEmailFeedback({ delivery: 'manual' }).message, /Development verification token/);
  assert.equal(verificationEmailFeedback({ delivery: 'unavailable' }).developmentToken, undefined);
  assert.equal(verificationEmailFeedback({ delivery: 'manual', development_token: 'short' }).developmentToken, undefined);
  const dev = verificationEmailFeedback({ delivery: 'manual', development_token: proof });
  assert.equal(dev.developmentToken, proof); assert.match(dev.message, /confirm your email here/);
  assert.equal(verificationEmailFeedback({ delivery: 'email_accepted' }).tone, 'success');
  assert.match(verificationEmailFeedback({ delivery: 'failed' }).message, /could not be confirmed/);
  assert.equal(passwordResetRequestFeedback({ accepted: true, recovery_available: false }).tone, 'warning');
  assert.equal(passwordResetRequestFeedback({ accepted: true }).tone, 'success', 'older server response remains compatible');
  assert.throws(() => passwordResetRequestFeedback({ accepted: false }));
});

test('mounted recovery form shows global unavailable result without claiming instructions were sent', async () => {
  let requests = 0;
  await mountedReset(async h => {
    await h.fill('Email', 'person@example.test'); await h.press('Send reset link');
    assert.equal(requests, 1); assert.match(h.text(), /Email recovery is currently unavailable/);
    assert.match(h.text(), /No reset email was requested/); assert.doesNotMatch(h.text(), /instructions will be sent/);
    assert.ok(h.text().includes('Back to sign in'));
  }, undefined, { mode: 'recovery', requestReset: async () => { requests++; return { accepted: true, recovery_available: false }; } });
});

test('mounted recovery uses the same check-inbox message without revealing account existence', async () => {
  await mountedReset(async h => {
    await h.fill('Email', 'person@example.test'); await h.press('Send reset link');
    assert.match(h.text(), /Check your email/);
    assert.match(h.text(), /If this email is linked to a ThatCampus account/);
    assert.equal(h.buttons.has('Save new password'), false);
    await h.press('Use a different email');
    assert.equal(h.fields.get('Email')?.value, '');
    assert.equal(h.buttons.get('Send reset link')?.disabled, true);
  }, undefined, { mode: 'recovery', requestReset: async () => ({ accepted: true, recovery_available: true }) });
});

test('a signed-in user can request a replacement reset link without leaving the recovery route', () => {
  const Redirect = Symbol('Redirect'), LoginScreen = Symbol('LoginScreen'), Page = Symbol('Page');
  const Button = () => null;
  const paths: string[] = [];
  let params: Record<string, unknown> = {};
  const { AuthEntryScreen } = load('src/auth/AuthEntryScreen.tsx', {
    'react/jsx-runtime': require('react/jsx-runtime'), 'expo-router': { Redirect, useLocalSearchParams: () => params, useRouter: () => ({ replace: (href: string) => paths.push(href) }) },
    './SessionProvider': { useSession: () => session }, './LoginScreen': { LoginScreen }, './auth-entry': { nativeAuthDestination },
    '../ui/components': { Button, Empty: Symbol('Empty'), Loading: Symbol('Loading'), Page },
  });
  const Screen = AuthEntryScreen as (props: { mode?: 'login' | 'recovery' }) => React.ReactElement<{ initialMode?: string; children?: React.ReactElement<ButtonProps>[] }>;
  assert.equal(Screen({ mode: 'login' }).type, Redirect);
  const recovery = Screen({ mode: 'recovery' });
  assert.equal(recovery.type, LoginScreen);
  assert.equal(recovery.props.initialMode, 'recovery');
  params = { account_link: 'invalid' };
  const invalid = Screen({ mode: 'login' });
  assert.equal(invalid.type, Page);
  for (const child of invalid.props.children ?? []) if (child.type === Button) child.props.onPress();
  assert.deepEqual(paths, ['/account/security', '/forgot-password']);
});


test('mounted verification screen shows unavailable warning for a production response and never invents a development token', async () => {
  for (const response of [{ delivery: 'unavailable' }, { delivery: 'manual' }]) {
    const { JSDOM } = require('jsdom'), dom = new JSDOM('<div id="root"></div>');
    const previous = { window: globalThis.window, document: globalThis.document, IS_REACT_ACT_ENVIRONMENT: (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT };
    Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
    const { createRoot } = require('react-dom/client'), fields = new Map<string, FieldProps>(), buttons = new Map<string, ButtonProps>(); let sends = 0;
    const Box = ({ children }: React.PropsWithChildren) => React.createElement('div', null, children);
    const dependencies = {
      react: React, 'react/jsx-runtime': require('react/jsx-runtime'), 'react-native': { Text: Box },
      'expo-router': { useRouter: () => ({ replace() {} }) }, './SessionProvider': { useSession: () => ({ ...session, refresh: async () => {} }) },
      '../lib/api': { getApiOrigin: () => 'https://app2.thatcampus.com', captureApiContext: () => ({ assertCurrent() {} }), apiFetch: async () => { sends++; return response; } }, '../lib/api-client': { ApiError },
      '../lib/query': { useApi: () => ({ data: null }) }, '../ui/Alert': { Alert: { alert() {} } },
      '../ui/BackNavigation': { ScreenBack: () => null, useScreenExitGuard() {}, useCampusNavigation: () => ({ onNavigate() {}, complete() {} }) },
      '../ui/components': { Page: Box, Section: Box, Row: Box, Empty: Box, Loading: Box, Field: (props: FieldProps) => { fields.set(props.label, props); return React.createElement('label', null, props.label); }, Button: (props: ButtonProps) => { buttons.set(props.title, props); return React.createElement('button', { disabled: props.disabled || props.busy, onClick: props.onPress }, props.title); }, Notice: ({ message, tone }: { message: string; tone: string }) => React.createElement('p', { 'data-tone': tone }, message) },
      '../ui/theme': { useTheme: () => ({ colors: {} }) }, './account-return': { accountReturnTitle: () => 'Back', safeAccountReturnTarget }, './auth-entry': { nativeAuthDestination },
      './visit-join-policy': { visitJoinReturnTarget: () => null }, './AuthenticatorQr': { AuthenticatorQr: () => null }, './account-recovery': { accountSecurityEntryHref, verificationEmailFeedback }, './account-mail-link': { accountMailLinks },
      './use-account-mail-entry': { useAccountMailEntry: () => ({ ready: true }) },
    };
    const Screen = load('src/auth/AccountSecurityScreen.tsx', dependencies).AccountSecurityScreen as React.ComponentType<{ href: string }>, root = createRoot(dom.window.document.getElementById('root'));
    try {
      await act(async () => root.render(React.createElement(Screen, { href: '/more/account/security?from=%2Fonboarding%2Fstart' })));
      await act(async () => { buttons.get('Send verification email')!.onPress(); });
      assert.equal(sends, 1); assert.match(dom.window.document.body.textContent, /Verification email is currently unavailable/);
      assert.doesNotMatch(dom.window.document.body.textContent, /Development verification token is ready/);
      assert.equal(fields.has('Verification token'), false);
      assert.equal(dom.window.document.querySelector('[data-tone="warning"]')?.textContent.includes('currently unavailable'), true);
    } finally { await act(async () => root.unmount()); dom.window.close(); Object.assign(globalThis, previous); }
  }
});
