import assert from 'node:assert/strict';
import test from 'node:test';
import { assistantOverlayMatches, assistantOverlayToken, assertAssistantOverlayLease, type AssistantOverlayEntry } from '../src/lib/assistant-overlay';
const entry: AssistantOverlayEntry = { key: 'real-events-editor',scope: 'actor:campus:live',sourceHref: '/areas/events/manage?create=1',href: '/areas/assistant/conversation',nonce: 7,open: true,expanded: false,canonical: false };
const focus = { key: entry.key,scope: entry.scope,href: entry.sourceHref };
test('Assistant bubble binds the actual keyed workspace and retains its lease across lossless expansion', () => {
  assert.equal(assistantOverlayMatches(entry,focus),true);
  assert.equal(assistantOverlayToken({ ...entry,expanded: true },focus),assistantOverlayToken(entry,focus));
  for (const changed of [{ ...focus,key: 'other-tab' },{ ...focus,scope: 'actor:campus:simulation:run' },{ ...focus,scope: 'other-account:campus:live' },{ ...focus,href: '/areas/events/manage?create=2' }]) assert.equal(assistantOverlayToken(entry,changed),'');
  assert.equal(assistantOverlayToken({ ...entry,open: false },focus),'');
});
test('closing, changing source and returning cannot resurrect an earlier secure-await lease', () => {
  let current = { token: `${assistantOverlayToken(entry,focus)}:10`,active: true,ready: true };
  const old = assertAssistantOverlayLease(current.token,() => current); old();
  current = { ...current,active: false }; assert.throws(old);
  current = { ...current,token: `${assistantOverlayToken(entry,focus)}:12`,active: true }; assert.throws(old,'same actor/entry returning has a fresh real-navigation epoch');
  const fresh = assertAssistantOverlayLease(current.token,() => current); fresh();
  current = { ...current,ready: false }; assert.throws(fresh);
});
test('unknown, inactive or verifying overlay cannot acquire a writer lease', () => {
  for (const current of [{ token: '',active: true,ready: true },{ token: 'present',active: false,ready: true },{ token: 'present',active: true,ready: false }]) assert.throws(() => assertAssistantOverlayLease(current.token,() => current));
});

test('a pending linked-student confirmation cannot clear or open after Close/reopen, draft or source change', async () => {
  const { captureAssistantIntentLease } = await import('../src/lib/assistant-overlay');
  for (const change of ['overlay','scope','key','href','state','draft','gone']) {
    const state = {}, initial = { scope: focus.scope,key: focus.key,href: focus.href,state,signature: 'question-v1',entryToken: 'opening-1' };
    let current: typeof initial | null = initial, cleared = 0, opened = 0, resolve!: () => void;
    const confirmation = new Promise<void>(done => { resolve = done; }), assertIntent = captureAssistantIntentLease(() => current);
    const pending = (async () => { await confirmation; try { assertIntent(); cleared++; opened++; } catch { /* Retain exact unsent question. */ } })();
    if (change === 'overlay') current = { ...initial,entryToken: 'opening-3' };
    if (change === 'scope') current = { ...initial,scope: 'new-world' };
    if (change === 'key') current = { ...initial,key: 'other-key' };
    if (change === 'href') current = { ...initial,href: '/areas/events' };
    if (change === 'state') current = { ...initial,state: {} };
    if (change === 'draft') current = { ...initial,signature: 'question-v2' };
    if (change === 'gone') current = null;
    resolve(); await pending; assert.equal(cleared,0,change); assert.equal(opened,0,change);
  }
});

test('a minimized Assistant stays pinned while the real app tabs change, without crossing an account or world',async()=>{
  const {currentAssistantOverlay}=await import('../src/lib/assistant-overlay');
  const entries=new Map([[entry.key,entry]]),other={...focus,key:'work-root',href:'/work'};
  assert.equal(currentAssistantOverlay(entries,other,entry.key,false),entry);
  assert.equal(currentAssistantOverlay(entries,{...other,scope:'another-account'},entry.key,false),undefined);
  assert.equal(currentAssistantOverlay(entries,other,null,false),undefined);
  const fullscreen={...entry,expanded:true};
  assert.equal(currentAssistantOverlay(new Map([[entry.key,fullscreen]]),other,entry.key,false),undefined,'phone fullscreen never turns into a second navigable pane');
  assert.equal(currentAssistantOverlay(new Map([[entry.key,fullscreen]]),other,entry.key,true),fullscreen,'tablet split remains usable beside the app');
});
