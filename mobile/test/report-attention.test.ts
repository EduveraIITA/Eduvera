import assert from 'node:assert/strict';
import test from 'node:test';
import type { FamilyReportCards, OwnReportCards } from '../../packages/contracts/src/academic-reports';
import type { FamilyResults } from '../../packages/contracts/src/assessments';
import { publishedOwnReportAttentionProof, publishedReportAttentionProof } from '../src/lib/report-attention';
const notification = '00000000-0000-4000-8000-000000000001', batch = '00000000-0000-4000-8000-000000000002', assessment = '00000000-0000-4000-8000-000000000003', publication = '00000000-0000-4000-8000-000000000004';
const reports = { student: { id: 'learner' }, reports: [{ batch_id: batch }] } as FamilyReportCards;
const results = { student: { id: 'learner' }, results: [{ id: assessment, publication_id: publication }] } as FamilyResults;
const href = `/areas/reports/progress?scope=dependent&student_id=learner&report_batch_id=${batch}&attention_notification_id=${notification}`;
test('only the exact loaded learner release acknowledges a report opening', () => {
  const proof = publishedReportAttentionProof(href, 'learner', undefined, reports); assert.equal(proof?.notificationId, notification); assert.equal(proof?.openedTarget, href); assert.ok(!proof?.cleanHref.includes('attention_notification_id')); assert.ok(proof?.cleanHref.includes(`report_batch_id=${batch}`));
  assert.equal(publishedReportAttentionProof(href, 'other', undefined, reports), null); assert.equal(publishedReportAttentionProof(href, 'learner', undefined, { ...reports, student: { ...reports.student, id: 'other' } }), null); assert.equal(publishedReportAttentionProof(href, 'learner', undefined, { ...reports, reports: [] }), null);
});
test('mixed, duplicate, stale and list-only report attention remains unread', () => {
  for (const changed of [href + `&report_batch_id=${batch}`, href + '&scope=self', href + `&assessment_id=${assessment}`, href.replace(`report_batch_id=${batch}`, ''), href.replace(batch, publication), href.replace(notification, 'invalid'), href.replace('scope=dependent', 'scope=institution')]) assert.equal(publishedReportAttentionProof(changed, 'learner', results, reports), null, changed);
  assert.equal(publishedReportAttentionProof(href, 'learner', undefined, { ...reports, reports: [...reports.reports, ...reports.reports] }), null);
});
test('assessment attention retains exact publication identity across Reports and Assessments', () => {
  for (const path of ['/areas/reports/progress', '/areas/assessments/results']) {
    const target = `${path}?scope=self&student_id=learner&assessment_id=${assessment}&publication_id=${publication}&attention_notification_id=${notification}`;
    assert.ok(publishedReportAttentionProof(target, 'learner', results)); assert.equal(publishedReportAttentionProof(target.replace(publication, batch), 'learner', results), null); assert.equal(publishedReportAttentionProof(target.replace(`&publication_id=${publication}`, ''), 'learner', results), null);
  }
});
test('canonical person attention binds the loaded own publication without a student identity',()=>{
  const own={learner:{learner_id:'person',person_id:'person',student_id:null},reports:[{batch_id:batch}]} as OwnReportCards;
  const target=`/areas/reports/progress?scope=mine&person_id=person&report_batch_id=${batch}&attention_notification_id=${notification}`;
  assert.equal(publishedOwnReportAttentionProof(target,'person',undefined,own)?.notificationId,notification);
  for(const changed of [target+'&student_id=person',target+'&person_id=person',target.replace('scope=mine','scope=self'),target.replace(batch,publication)])assert.equal(publishedOwnReportAttentionProof(changed,'person',undefined,own),null);
  assert.equal(publishedOwnReportAttentionProof(target,'other',undefined,own),null);assert.equal(publishedOwnReportAttentionProof(target,'person',undefined,{...own,learner:{...own.learner,person_id:'other'}}),null);
});
