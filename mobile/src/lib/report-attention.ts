import type { FamilyReportCards, OwnReportCards } from '../../../packages/contracts/src/academic-reports';
import type { FamilyResults, OwnAssessmentResults } from '../../../packages/contracts/src/assessments';
export interface ReportAttentionProof { notificationId: string; openedTarget: string; cleanHref: string; key: string }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** Loaded identity + exact published release, never a list visit, proves an opening. */
export function publishedReportAttentionProof(href: string, studentId: string, results?: FamilyResults, reports?: FamilyReportCards): ReportAttentionProof | null {
  if (href.includes('#')) return null;
  const [path, query = ''] = href.split('?'); if (!['/areas/reports/progress', '/areas/assessments/results'].includes(path!)) return null;
  const q = new URLSearchParams(query);
  if (['scope', 'student_id', 'attention_notification_id'].some(key => q.getAll(key).length !== 1) || !['self', 'dependent'].includes(q.get('scope')!) || q.get('student_id') !== studentId) return null;
  const notificationId = q.get('attention_notification_id')!; if (!uuid.test(notificationId)) return null;
  const batch = q.get('report_batch_id'), assessment = q.get('assessment_id'), publication = q.get('publication_id');
  if (batch) {
    if (q.getAll('report_batch_id').length !== 1 || q.has('assessment_id') || q.has('publication_id') || !uuid.test(batch) || reports?.student.id !== studentId || reports.reports.filter(item => item.batch_id === batch).length !== 1) return null;
  } else if (assessment && publication) {
    if (q.has('report_batch_id') || q.getAll('assessment_id').length !== 1 || q.getAll('publication_id').length !== 1 || !uuid.test(assessment) || !uuid.test(publication) || results?.student.id !== studentId || results.results.filter(item => item.id === assessment && item.publication_id === publication).length !== 1) return null;
  } else return null;
  q.delete('attention_notification_id');
  return { notificationId, openedTarget: href, cleanHref: `${path}?${q}`, key: JSON.stringify([href, studentId, batch ?? assessment, publication]) };
}
/** A canonical person publication is never represented by a fabricated student. */
export function publishedOwnReportAttentionProof(href:string,personId:string,results?:OwnAssessmentResults,reports?:OwnReportCards):ReportAttentionProof|null {
  if(href.includes('#'))return null;
  const [path,query='']=href.split('?');if(!['/areas/reports/progress','/areas/assessments/results'].includes(path!))return null;
  const q=new URLSearchParams(query);
  if(['scope','person_id','attention_notification_id'].some(key=>q.getAll(key).length!==1)||q.get('scope')!=='mine'||q.get('person_id')!==personId||q.has('student_id'))return null;
  const notificationId=q.get('attention_notification_id')!;if(!uuid.test(notificationId))return null;
  const batch=q.get('report_batch_id'),assessment=q.get('assessment_id'),publication=q.get('publication_id');
  if(batch){
    if(q.getAll('report_batch_id').length!==1||q.has('assessment_id')||q.has('publication_id')||!uuid.test(batch)||reports?.learner?.person_id!==personId||reports.learner.learner_id!==personId||reports.reports.filter(item=>item.batch_id===batch).length!==1)return null;
  }else if(assessment&&publication){
    if(q.has('report_batch_id')||q.getAll('assessment_id').length!==1||q.getAll('publication_id').length!==1||!uuid.test(assessment)||!uuid.test(publication)||results?.learner?.person_id!==personId||results.learner.learner_id!==personId||results.results.filter(item=>item.id===assessment&&item.publication_id===publication).length!==1)return null;
  }else return null;
  q.delete('attention_notification_id');return {notificationId,openedTarget:href,cleanHref:`${path}?${q}`,key:JSON.stringify([href,'mine',personId,batch??assessment,publication])};
}
