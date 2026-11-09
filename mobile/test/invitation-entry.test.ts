import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import React, { act } from 'react';
import ts from 'typescript';
import { checkedAcceptedInvitation, checkedInvitationProof, invitationFromFragment, validateInvitationContinuation } from '../src/auth/invitation-entry';
import * as entry from '../src/auth/invitation-entry';
import * as publicForm from '../src/auth/public-form-operation';
import { ApiError } from '../src/lib/api-client';

const school = '00000000-0000-4000-8000-000000000001', actor = '00000000-0000-4000-8000-000000000002', invitation = '00000000-0000-4000-8000-000000000003', source = '00000000-0000-4000-8000-000000000004';
const proof = { campus: { id: school, name: 'Invited campus' }, invitation_id: invitation, verification_required: true, delivery: 'email_accepted' as const };
const origin = 'https://campus.example.test';
const firstToken = 'first-local-invitation-'.padEnd(43, 'x');
const recipient = 'recipient+evening@example.test';
const link = (email: string, token: string) => `/join#${new URLSearchParams({ email, token })}`;
const require = createRequire(import.meta.url);

test('invitation fragments require the bounded original code and recipient', () => {
  assert.deepEqual(invitationFromFragment('#token=123456&email=recipient%40example.test'), { token: '123456', email: 'recipient@example.test' });
  assert.deepEqual(invitationFromFragment(new URL(link(recipient, firstToken), origin).hash), { token: firstToken, email: recipient });
  assert.deepEqual(invitationFromFragment('token=123456&email=recipient+pilot@example.test'), { token: '123456', email: 'recipient+pilot@example.test' });
  for (const fragment of [
    'token=123&email=recipient%40example.test',
    'token=123456&email=wrong',
    'token='+ 'a'.repeat(101) +'&email=recipient%40example.test',
    'token=123456&token=456789&email=recipient%40example.test',
    'token=123456&email=recipient%40example.test&email=other%40example.test',
  ]) assert.deepEqual(invitationFromFragment(fragment), { token: '', email: '' });
});
test('proof and accepted results require exact campus and stable account identity', () => {
  assert.equal(checkedInvitationProof(proof), proof);
  assert.equal(checkedAcceptedInvitation({ school_id: school, accepted_user_id: actor, role: 'member' }, proof).accepted_user_id, actor);
  for (const bad of [{...proof, retry_after_seconds:-1},{...proof, verification_required:'yes'},{...proof, campus:{id:'wrong',name:'Other'}}]) assert.throws(() => checkedInvitationProof(bad));
  for (const bad of [{school_id:actor,accepted_user_id:actor,role:'member'},{school_id:school,accepted_user_id:'wrong',role:'member'},{school_id:school,accepted_user_id:actor,role:'owner'}]) assert.throws(() => checkedAcceptedInvitation(bad,proof));
});
test('a continuation cannot substitute another invitation, source, campus or URL', () => {
  const continuation = {kind:'facility_repair',label:'Open repair',school_id:school,invitation_id:invitation,source_id:source,href:`/areas/facilities?repair_id=${source}`};
  assert.equal(validateInvitationContinuation(continuation,school,invitation),continuation);
  for (const bad of [{...continuation,invitation_id:source},{...continuation,school_id:actor},{...continuation,href:'https://outside.example'},{...continuation,source_id:actor},{...continuation,label:'Open campus'}]) assert.throws(() => validateInvitationContinuation(bad,school,invitation));
});

type RouteParams = Record<string, string | string[] | undefined>;
type Request = { path: string; body: unknown };
type Field = { label: string; value: string; onChangeText(value: string): void };
type Button = { title: string; disabled?: boolean; busy?: boolean; onPress(): void };
type Box = React.PropsWithChildren<{ title?: string; subtitle?: string; message?: string }>;
type Mounted = {
  window: Window;
  fields: Map<string, Field>;
  replacements: RouteParams[];
  requests: Request[];
  navigations: string[];
  press(title: string): Promise<void>;
  fill(label: string, value: string): Promise<void>;
  changeUrl(path: string): Promise<void>;
  remount(): Promise<void>;
};

async function mounted(path: string, work: (view: Mounted) => Promise<void>, staleParams?: RouteParams) {
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<div id="root"></div>', { url: new URL(path, origin).href });
  const window: Window = dom.window;
  const previous = { window: globalThis.window, document: globalThis.document,
    IS_REACT_ACT_ENVIRONMENT: (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT };
  Object.assign(globalThis, { window, document: window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const { createRoot } = require('react-dom/client');
  const fields = new Map<string, Field>(), buttons = new Map<string, Button>();
  const replacements: RouteParams[] = [], requests: Request[] = [], navigations: string[] = [];
  const snapshot = () => {
    const url = new URL(window.location.href), params: RouteParams = Object.fromEntries(url.searchParams);
    // Expo's useLocalSearchParams decodes the complete fragment, including an email's encoded plus.
    if (url.hash) params['#'] = decodeURIComponent(url.hash.slice(1));
    return params;
  };
  let route = staleParams ?? snapshot();
  window.history.replaceState({ id: 'fixture-history-entry', entry: route }, '', window.location.href);
  const navigation = { replaceParams: (params: RouteParams) => { replacements.push({ ...params }); route = { ...params }; } };
  const router = { push: (href: string) => navigations.push(href), replace: (href: string) => navigations.push(href) };
  const box = ({ children, title, subtitle, message }: Box) => React.createElement('section', null, title, subtitle, message, children);
  const button = (value: Button) => {
    buttons.set(value.title, value);
    return React.createElement('button', { disabled: value.disabled || value.busy, onClick: value.onPress }, value.title);
  };
  const field = (value: Field) => {
    fields.set(value.label, value);
    return React.createElement('input', { 'aria-label': value.label, value: value.value, readOnly: true });
  };
  const dependencies: Record<string, unknown> = {
    react: React, 'react/jsx-runtime': require('react/jsx-runtime'),
    'react-native': { AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) }, Platform: { OS: 'web' } },
    'expo-router': { Stack: { Screen: () => null }, useIsFocused: () => true, useLocalSearchParams: () => route,
      useRouter: () => router, useNavigation: () => navigation },
    './SessionProvider': { useSession: () => ({ status: 'anonymous', scopeKey: 'anonymous', environment: { mode: 'live' } }) },
    './invitation-entry': entry, './public-form-operation': publicForm,
    '../lib/api': { getApiOrigin: () => origin, captureApiContext: () => ({ assertCurrent() {} }),
      apiFetch: async (requestPath: string, init?: RequestInit) => {
        if (requestPath === '/api/v1/auth/csrf/') return {};
        requests.push({ path: requestPath, body: JSON.parse(String(init?.body ?? '{}')) });
        if (requestPath === '/api/v1/invitations/recipient-proof/') return proof;
        assert.equal(requestPath, '/api/v1/invitations/accept/');
        return { school_id: school, role: 'member', accepted_user_id: actor };
      } },
    '../lib/api-client': { ApiError },
    '../ui/components': { Button: button, Empty: box, Field: field, Loading: box, Notice: box, Page: box, Section: box },
    '../ui/DomainControls': { ControlButton: button, Facts: ({ items }: { items: { label: string; value: string }[] }) =>
      React.createElement('dl', null, items.map(item => React.createElement('dd', { key: item.label }, item.value))) },
    '../ui/BackNavigation': { useScreenExitGuard() {} },
    '../ui/theme': { useTheme: () => ({ colors: {} }) },
  };
  const source = ts.transpileModule(readFileSync(new URL('../src/auth/JoinScreen.tsx', import.meta.url), 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const exports: Record<string, unknown> = {};
  runInNewContext(source, { exports, URL, URLSearchParams, window, setInterval, clearInterval, require(name: string) {
    assert.ok(name in dependencies, `Unexpected invitation dependency ${name}`);
    return dependencies[name];
  } });
  const screen = exports.JoinScreen as React.ComponentType;
  let root = createRoot(window.document.getElementById('root'));
  const render = () => act(async () => root.render(React.createElement(screen)));
  try {
    await render();
    await work({ window, fields, replacements, requests, navigations,
      async press(title) {
        const action = buttons.get(title);
        assert.ok(action, `Missing invitation action ${title}`);
        assert.equal(!!action.disabled, false, title);
        await act(async () => action.onPress());
      },
      async fill(label, value) {
        const input = fields.get(label);
        assert.ok(input, `Missing invitation field ${label}`);
        await act(async () => input.onChangeText(value));
      },
      async changeUrl(next) {
        await act(async () => {
          window.history.replaceState(window.history.state, '', next);
          route = snapshot();
          root.render(React.createElement(screen));
        });
      },
      async remount() {
        await act(async () => root.unmount());
        route = snapshot();
        fields.clear(); buttons.clear();
        root = createRoot(window.document.getElementById('root'));
        await render();
      },
    });
    assert.equal(window.localStorage.length, 0);
    assert.equal(window.sessionStorage.length, 0);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    Object.assign(globalThis, previous);
  }
}

test('opened invitation clears the address and Expo params before requesting separate mailbox proof', async () => {
  await mounted(link(recipient, firstToken), async view => {
    assert.equal(view.window.location.pathname, '/join');
    assert.equal(view.window.location.hash, '');
    assert.ok(!JSON.stringify(view.window.history.state).includes(firstToken));
    assert.equal(view.replacements.length, 1);
    assert.equal(Object.hasOwn(view.replacements[0]!, '#'), false);
    assert.ok(!JSON.stringify(view.replacements).includes(firstToken));
    assert.equal(view.fields.has('Invitation code'), false);
    assert.ok(!view.window.document.body.innerHTML.includes(firstToken));
    assert.deepEqual(view.requests, []);

    await view.press('Continue');
    assert.deepEqual(view.requests, [{ path: '/api/v1/invitations/recipient-proof/', body: { email: recipient, token: firstToken } }]);
    assert.ok(view.fields.has('Email verification code'));
    const name = 'Example Recipient', password = 'Synthetic!Pass994', mailboxCode = '912345';
    await view.fill('Name', name);
    await view.fill('Account password', password);
    await view.fill('Email verification code', mailboxCode);
    await view.press('Accept invitation');
    assert.deepEqual(view.requests[1], { path: '/api/v1/invitations/accept/', body: {
      email: recipient, token: firstToken, first_name: name, last_name: '', password, recipient_proof: mailboxCode,
    } });
    await view.press('Sign in');
    assert.deepEqual(view.navigations, [`/login?next=${encodeURIComponent(`/join?campus=${school}&invitation=${invitation}`)}`]);
  });
});

test('a new invitation replaces the earlier prefill and a cold /join keeps manual entry', async () => {
  const secondToken = 'second-local-invitation-'.padEnd(43, 'z');
  await mounted(link(recipient, firstToken), async view => {
    await view.changeUrl(link('other@example.test', secondToken));
    assert.equal(view.window.location.hash, '');
    assert.ok(!view.window.document.body.innerHTML.includes(firstToken));
    assert.ok(!view.window.document.body.innerHTML.includes(secondToken));
    await view.press('Continue');
    assert.deepEqual(view.requests, [{ path: '/api/v1/invitations/recipient-proof/', body: { email: 'other@example.test', token: secondToken } }]);

    await view.remount();
    assert.equal(view.fields.get('Email')?.value, '');
    assert.equal(view.fields.get('Invitation code')?.value, '');
    await view.fill('Email', recipient);
    await view.fill('Invitation code', '123456');
    await view.press('Continue');
    assert.deepEqual(view.requests[1], { path: '/api/v1/invitations/recipient-proof/', body: { email: recipient, token: '123456' } });
  });
});

test('ambiguous invitation fragments are scrubbed without prefill or a proof request', async () => {
  await mounted(`${link(recipient, firstToken)}&token=123456`, async view => {
    assert.equal(view.window.location.hash, '');
    assert.ok(!JSON.stringify(view.window.history.state).includes(firstToken));
    assert.equal(Object.hasOwn(view.replacements[0]!, '#'), false);
    assert.ok(!view.window.document.body.innerHTML.includes(firstToken));
    assert.deepEqual(view.requests, []);
    for (const input of view.fields.values()) assert.equal(input.value, '');
  });
});

test('an inactive invitation route cannot scrub a different screen or replay its stale params', async () => {
  const other = '/reset-password#token=unrelated-account-reset-proof';
  await mounted(other, async view => {
    assert.equal(view.window.location.href, new URL(other, origin).href);
    assert.deepEqual(view.replacements, []);
    assert.deepEqual(view.requests, []);
  }, { '#': new URL(link(recipient, firstToken), origin).hash.slice(1) });
});
