import type { AdminDeparture, CollectorDeparture, DutySwap, FamilyDeparture } from '../../../packages/contracts/src/wire/features/departure/api';
export function departureFocusedFirst<T extends {id:string}>(rows:readonly T[],id:string|null|undefined):T[] { return id?[...rows.filter(row=>row.id===id),...rows.filter(row=>row.id!==id)]:[...rows]; }
export function departureManagementFocus(data:AdminDeparture,href:string) {
  const q=new URLSearchParams(href.split('?')[1]??''),section=q.get('section'),planId=q.get('plan')??q.get('plan_id'),requestId=q.get('request'),swapId=q.get('swap'),tripId=q.get('trip');
  const plan=planId?data.plans.find(row=>row.id===planId&&row.student_id===q.get('student')&&row.service_date===q.get('date')&&section==='pickup'):undefined;
  const request=requestId?data.requests.find(row=>row.id===requestId&&section==='requests'):undefined;
  const swap=swapId?data.swaps.find(row=>row.id===swapId&&row.school_id===data.school.id&&section==='roster'):undefined;
  const trip=tripId?data.trips.find(row=>row.id===tripId&&row.school_id===data.school.id&&section==='roster'):undefined;
  const expectedRevision=Number(q.get('swap_revision')),staleSwap=!!swapId&&!!q.get('swap_revision')&&(!Number.isSafeInteger(expectedRevision)||expectedRevision<1||swap?.revision!==expectedRevision);
  return {planId,requestId,swapId,tripId,plan,request,swap,trip,staleSwap,
    planUnavailable:!!planId&&!plan,requestUnavailable:!!requestId&&!request,swapUnavailable:!!swapId&&!swap,tripUnavailable:!!tripId&&!trip};
}
export function departureCollectorSwap(data:CollectorDeparture,id:string|null,revision:string|null,actor:string,school:string) {
  const swap=data.swaps.find(row=>row.id===id&&row.school_id===school&&[row.requester_user_id,row.target_user_id].includes(actor)),expected=Number(revision);
  return {swap,unavailable:!!id&&!swap,changed:!!id&&!!revision&&(!Number.isSafeInteger(expected)||expected<1||swap?.revision!==expected)};
}
export function departureFamilyFocus(data:FamilyDeparture,href:string) {
  const q=new URLSearchParams(href.split('?')[1]??''),trip=q.get('trip_id'),request=q.get('request_id'),plan=q.get('plan_id');
  return {trip,request,plan,tripUnavailable:!!trip&&!data.journeys.some(row=>row.id===trip),requestUnavailable:!!request&&!data.requests.some(row=>row.id===request),planUnavailable:!!plan&&data.plan?.id!==plan};
}
export function departureFocusedSwapNotice(swap:DutySwap,expected:string|null) {
  return expected&&Number(expected)!==swap.revision?'This duty change was updated after the linked notification. Review its current state.':`Current duty change: ${swap.status.replaceAll('_',' ')}. ${swap.decision_note||swap.response_note||swap.reason}`;
}
