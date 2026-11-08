import type { AcademicReportReferences, GradingSchemeDetail, GradingSchemeSummary, ReportBatchDetail } from '../../../packages/contracts/src/academic-reports';
import type { LearningOfferingReference } from '../../../packages/contracts/src/wire/features/learning/offeringApi';

const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const text=(value:unknown):value is string=>typeof value==='string'&&value.length>0;
export const academicReportWorkspacePath=(root:string)=>`${root}/workspace/?academic_context=offering_v1`;
export function academicOfferingHref(target:string,source:string):string {
  const query=new URLSearchParams(source.split('?')[1]??''),ids=query.getAll('offering_id');
  if(ids.length!==1||!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(ids[0]!))return target;
  const next=new URLSearchParams(target.split('?')[1]??'');next.set('offering_id',ids[0]!);
  return `${target.split('?')[0]}?${next}`;
}
export function reportContextKind(value:unknown):'class_term'|'learning_offering'|null {
  if(!object(value))return null;
  const kind=value.context_kind??'class_term',ids=value.offering_ids??[];
  if(!Array.isArray(ids)||!ids.every(text)||new Set(ids).size!==ids.length)return null;
  if(kind==='class_term')return text(value.class_section_id)&&ids.length===0?'class_term':null;
  return kind==='learning_offering'&&value.class_section_id===null&&ids.length>0?'learning_offering':null;
}
export function reportOfferingReferenceMatches(value:unknown):value is LearningOfferingReference {
  if(!object(value)||!text(value.id)||!text(value.name)||!Number.isSafeInteger(value.revision)||Number(value.revision)<1||!Number.isSafeInteger(value.learner_count)||Number(value.learner_count)<0)return false;
  if(value.academic_context===null)return true;
  const context=value.academic_context;
  return object(context)&&['term_id','subject_id','course_code','term_name','academic_year','starts_on','ends_on','subject_name','color','icon'].every(key=>text(context[key]))
    &&typeof context.credits==='number'&&Number.isFinite(context.credits)&&context.credits>0&&context.credits<=1000&&(context.programme_key===null||text(context.programme_key));
}
export function reportSameContext(a:GradingSchemeSummary,b:GradingSchemeSummary|ReportBatchDetail['batch']):boolean {
  const kind=reportContextKind(a);
  return !!kind&&kind===reportContextKind(b)&&a.class_section_id===b.class_section_id
    &&JSON.stringify([...(a.offering_ids??[])].sort())===JSON.stringify([...(b.offering_ids??[])].sort());
}
export function reportTermOfferings(references:AcademicReportReferences,termId:string):LearningOfferingReference[] {
  return (references.offerings??[]).filter(offering=>reportOfferingReferenceMatches(offering)&&offering.academic_context?.term_id===termId);
}
export function reportPlanOffering(references:AcademicReportReferences,scheme:GradingSchemeDetail['scheme'],offeringId:string):LearningOfferingReference|undefined {
  if(reportContextKind(scheme)!=='learning_offering'||!scheme.offering_ids?.includes(offeringId))return undefined;
  return reportTermOfferings(references,scheme.term_id).find(offering=>offering.id===offeringId);
}
export function eligibleReportAssessments(references:AcademicReportReferences,scheme:GradingSchemeDetail['scheme'],subjectId:string,offeringId?:string) {
  const kind=reportContextKind(scheme);
  return references.assessments.filter(item=>item.subject_id===subjectId&&item.term_id===scheme.term_id&&(kind==='learning_offering'
    ?item.context_kind==='learning_offering'&&item.class_section_id===null&&item.offering_id===offeringId&&!!offeringId&&scheme.offering_ids?.includes(offeringId)
    :(item.context_kind??'class_term')==='class_term'&&item.class_section_id===scheme.class_section_id&&!item.offering_id));
}
export function reportLearnerCommentEndpoint(root:string,batch:ReportBatchDetail['batch'],learner:ReportBatchDetail['students'][number]):string|null {
  if(reportContextKind(batch)==='learning_offering')return text(learner.learner_id)&&text(learner.person_id)
    ?`${root}/batches/${encodeURIComponent(batch.id)}/learners/${encodeURIComponent(learner.learner_id)}/comments/`:null;
  return text(learner.student_id)?`${root}/batches/${encodeURIComponent(batch.id)}/students/${encodeURIComponent(learner.student_id)}/comments/`:null;
}
