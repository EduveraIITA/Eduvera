import assert from 'node:assert/strict';
import test from 'node:test';
import { campusHrefForRoute, type CampusNavigationState } from '../src/lib/back-policy';
import { createCampusBrowserMetadata } from '../src/lib/back-presentation';
const source = { id: 'sdk:0',key: 'work-entry',href: '/work?page=3',title: 'Work' };

test('SDK browser entry IDs distinguish real repeated visits to the same retained route key', () => {
  const labels = createCampusBrowserMetadata(); labels.selectScope('actor:campus:live'); labels.observe(source);
  labels.begin('/areas/assessments?assessment=one',labels.get(source.id));
  const detail = { id: 'sdk:1',key: 'detail-entry',href: '/areas/assessments?assessment=one',title: 'Term results' };
  labels.observe(detail); assert.equal(labels.originFor('sdk:1')?.id,source.id);
  labels.begin('/work?page=3',labels.get(detail.id)); labels.observe({ ...source,id: 'sdk:2' });
  labels.begin(detail.href,labels.get('sdk:2')); labels.observe({ ...detail,id: 'sdk:3' });
  assert.equal(labels.originFor('sdk:3')?.id,'sdk:2');
  assert.equal(labels.originFor('sdk:2')?.id,'sdk:1');
  assert.equal(labels.originFor('sdk:1')?.id,'sdk:0');
  labels.observe(detail); assert.equal(labels.originFor('sdk:1')?.id,'sdk:0');
});
test('query filter replacement preserves its real originating browser visit', () => {
  const labels = createCampusBrowserMetadata(); labels.selectScope('one'); labels.observe(source);
  labels.begin('/areas/people?search=A',source); labels.observe({ id: 'sdk:1',key: 'people',href: '/areas/people?search=A',title: 'People' });
  labels.observe({ id: 'sdk:1',key: 'people',href: '/areas/people?search=B&page=2',title: 'People' });
  assert.deepEqual(labels.originFor('sdk:1'),source);
});
test('acknowledged completion replaces only presentation and retains the original source instead of finished editor', () => {
  const labels = createCampusBrowserMetadata(); labels.selectScope('one'); labels.observe(source);
  const editor = { id: 'sdk:1',key: 'new-editor',href: '/areas/messages/updates/new',title: 'New update' };
  labels.begin(editor.href,source); labels.observe(editor);
  labels.begin('/areas/messages/updates/accepted-1',labels.get(editor.id),true);
  labels.observe({ id: editor.id,key: 'accepted-result',href: '/areas/messages/updates/accepted-1',title: 'Saved update' });
  assert.deepEqual(labels.originFor(editor.id),source);
});
test('unexpected browser IDs, mismatched pending targets and same old entry never invent an origin', () => {
  const labels = createCampusBrowserMetadata(); labels.selectScope('one'); labels.observe(source);
  labels.begin('/areas/fees',source); labels.observe({ ...source,href: '/areas/fees' });
  assert.equal(labels.originFor(source.id),undefined); assert.equal(labels.pending,true);
  labels.observe({ id: 'sdk:unknown',key: 'other',href: '/areas/calendar' });
  assert.equal(labels.originFor('sdk:unknown'),undefined);
});
test('actor/campus/world scope reset clears all labels and in-flight source metadata', () => {
  const labels = createCampusBrowserMetadata(); labels.selectScope('actor:campus:live'); labels.observe(source); labels.begin('/areas/fees',source);
  labels.selectScope('actor:campus:simulation'); labels.observe({ id: 'sdk:1',key: 'fees',href: '/areas/fees' });
  assert.equal(labels.get(source.id),undefined); assert.equal(labels.pending,false); assert.equal(labels.originFor('sdk:1'),undefined);
});

test('real index route ignores stale catch-all path params after retained tab selection', () => {
  const state: CampusNavigationState = { key: 'tabs',index: 0,type: 'tab',routes: [{ key: 'more-tab',name: 'more',state: { key: 'more-stack',index: 0,type: 'stack',routes: [{ key: 'more-index',name: 'index',params: { path: ['assessments','manage'] } }] } }] };
  assert.equal(campusHrefForRoute(state,'more-index'),'/more');
});
