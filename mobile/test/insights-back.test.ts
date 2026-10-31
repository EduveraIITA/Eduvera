import assert from 'node:assert/strict';
import test from 'node:test';
import { campusBackFallback, campusExistingBackTarget, campusHrefForRoute, campusOwnerTitle, type CampusNavigationState } from '../src/lib/back-policy';
import { createCampusBrowserMetadata } from '../src/lib/back-presentation';
import { nativeInsightsBackParent } from '../src/lib/native-insights';

test('cold and reloaded Insights topics return to the overview with the exact reporting context', () => {
  for (const topic of ['attendance', 'results', 'progress', 'institution', 'registers', 'review', 'recording', 'followups', 'learning-review', 'operations', 'finance']) {
    const parent = nativeInsightsBackParent(`/areas/insights/${topic}?scope=assigned&period=90&class=class-a&compare=class&return_to=https%3A%2F%2Foutside.test&attention_notification_id=notice`);
    assert.ok(parent); assert.equal(parent.title, 'Insights');
    const url = new URL(parent.href, 'https://campus.invalid');
    assert.equal(url.pathname, '/areas/insights');
    for (const [key,value] of Object.entries({ scope: 'assigned',period: '90',class: 'class-a',compare: 'class' })) assert.equal(url.searchParams.get(key),value,key);
    assert.equal(url.searchParams.has('return_to'),false); assert.equal(url.searchParams.has('attention_notification_id'),false);
  }
  assert.equal(campusOwnerTitle('/areas/insights?scope=assigned'),'Insights');
  assert.deepEqual(campusBackFallback('/areas/insights/results?scope=assigned&period=90&class=class-a&compare=class'),{ href: '/areas/insights?scope=assigned&period=90&class=class-a&compare=class',title: 'Insights' });
});
test('cold learner review returns to Attendance review with its original page and filters', () => {
  const href = '/areas/insights/review/learner-a?scope=institution&insight_page=3&class_id=class-a&date=2026-10-29&insight_days=28&insight_threshold=50&followup=due&via=attendance';
  const parent = nativeInsightsBackParent(href);
  assert.ok(parent); assert.equal(parent.title,'Attendance review');
  const url = new URL(parent.href,'https://campus.invalid'); assert.equal(url.pathname,'/areas/insights/review');
  for (const [key,value] of Object.entries({ scope: 'institution',insight_page: '3',class_id: 'class-a',date: '2026-10-29',insight_days: '28',insight_threshold: '50',followup: 'due',via: 'attendance' })) assert.equal(url.searchParams.get(key),value,key);
  assert.deepEqual(campusBackFallback(href),parent);
});
test('family and ambiguous selectors stay exact instead of inventing another learner or scope', () => {
  const parent = nativeInsightsBackParent('/areas/insights/results?scope=dependent&student_id=child-b&student_id=child-a&period=30&period=90&insight_class=class-a');
  assert.ok(parent); const url = new URL(parent.href,'https://campus.invalid');
  assert.deepEqual(url.searchParams.getAll('student_id'),['child-b','child-a']);
  assert.deepEqual(url.searchParams.getAll('period'),['30','90']);
  assert.equal(url.searchParams.get('scope'),'dependent'); assert.equal(url.searchParams.get('insight_class'),'class-a');
});
test('overview has Areas as parent while unrelated or invalid paths have no Insights parent', () => {
  assert.deepEqual(nativeInsightsBackParent('/areas/insights?scope=assigned'),{ href: '/areas',title: 'Areas' });
  for (const href of ['/areas/insights/not-a-topic','/areas/insights/results/student-a','/areas/insights/review/a%2Fb','/areas/people','https://outside.test/areas/insights/results']) assert.equal(nativeInsightsBackParent(href),null,href);
});
test('real Work and More browser origins win through topic filters and browser back/forward', () => {
  for (const origin of [{ id: 'sdk:work',key: 'work-entry',href: '/work?search=reports&page=3',title: 'Work' },{ id: 'sdk:more',key: 'more-entry',href: '/more?search=reports',title: 'More' }]) {
    const labels = createCampusBrowserMetadata(); labels.selectScope('actor:campus:simulation'); labels.observe(origin);
    const detail = { id: 'sdk:insights',key: 'insights-topic',href: '/areas/insights/results?scope=assigned',title: 'Result analysis' };
    labels.begin(detail.href,labels.get(origin.id)); labels.observe(detail);
    labels.observe({ ...detail,href: detail.href + '&period=90&class=class-a' });
    assert.deepEqual(labels.originFor(detail.id),origin);
    labels.observe(origin); labels.observe(detail); assert.deepEqual(labels.originFor(detail.id),origin);
    assert.equal(campusBackFallback(detail.href)?.title,'Insights','fallback does not change real-origin metadata');
    labels.selectScope('actor:campus:live'); labels.observe(detail); assert.equal(labels.originFor(detail.id),undefined,'scope change cannot reuse the prior world origin');
  }
});
test('reload without an observed origin uses its declared filtered parent without inventing history', () => {
  const labels = createCampusBrowserMetadata(); labels.selectScope('actor:campus:simulation');
  const detail = { id: 'sdk:reloaded-insights',key: 'reloaded-topic',href: '/areas/insights/results?scope=dependent&student_id=child-b&period=30',title: 'Result analysis' };
  labels.observe(detail); assert.equal(labels.originFor(detail.id),undefined);
  assert.deepEqual(campusBackFallback(detail.href),{ href: '/areas/insights?scope=dependent&student_id=child-b&period=30',title: 'Insights' });
});
test('a generated cold Areas index is not mistaken for the declared Insights topic parent', () => {
  const anchor = { key: 'cold-areas-index',name: 'index',params: { path: ['insights','results'],scope: 'assigned',period: '90' } };
  const detail = { key: 'cold-insights-results',name: '[...path]',params: { path: ['insights','results'],scope: 'assigned',period: '90',class: 'class-a' } };
  const child: CampusNavigationState = { key: 'cold-areas-stack',index: 1,type: 'stack',routes: [anchor,detail] };
  const state: CampusNavigationState = { key: 'tabs',index: 0,type: 'tab',routes: [{ key: 'areas-tab',name: 'areas',state: child }] };
  const parent = campusBackFallback(campusHrefForRoute(state,detail.key)!);
  assert.ok(parent); assert.equal(parent.title,'Insights');
  assert.equal(campusExistingBackTarget(state,parent.href),null,'Areas index cannot pop in place of the Insights overview');
  assert.equal(campusHrefForRoute(state,anchor.key),'/areas?scope=assigned&period=90');
});
