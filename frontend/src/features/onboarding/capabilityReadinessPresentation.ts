import type { CapabilityReadiness } from './progressive-api';

/** These are source-state labels, never permission or completion decisions. */
export function capabilityReadinessPresentation(item: CapabilityReadiness): { description: string; action: string } {
  const fallback = { description: item.status === 'working' ? 'Open your workspace' : item.missing[0]?.reason ?? 'Set up the essentials',
    action: `Open ${item.label.toLowerCase()}` };
  if(item.capability==='dining'){
    switch(item.dining_operation?.state){
      case 'menu_published':return {description:'Menu and hours published · serving is recorded separately.',action:item.dining_operation.scope?.kind==='plan'?'Open weekly menu':'Open dated service'};
      case 'draft_recorded':return {description:'Draft saved · review before publishing.',action:'Continue dining draft'};
      case 'ready_to_plan':return {description:'Plan a menu once or weekly.',action:'Plan menu'};
      case 'needs_service':return {description:'Start with a service, or reference an existing system.',action:'Add dining service'};
      case 'unavailable':return {description:'Review your current dining responsibility.',action:'Review dining access'};
    }
    return {description:'Menus, serving hours and owned exceptions.',action:'Open dining'};
  }
  if(item.capability==='accommodation'){
    switch(item.accommodation_operation?.state){
      case 'arrangement_recorded':return {description:'Arrangement accepted · follow the move and access items.',action:'Open stay'};
      case 'offer_recorded':return {description:'Offer sent · awaiting the resident’s response.',action:'Continue offer'};
      case 'ready_to_offer':return {description:'Assign a room, or send an offer for a resident to accept.',action:'Assign room'};
      case 'needs_rooms':return {description:'Start with one room and its sleeping capacity.',action:'Add a room'};
      case 'unavailable':return {description:'Review your current accommodation responsibility.',action:'Review accommodation access'};
    }
    return {description:'Rooms, stays and temporary moves.',action:'Open accommodation'};
  }
  if(item.capability==='facilities'){
    switch(item.facilities_operation?.state){
      case 'repair_recorded':return {description:'Repair reported · follow progress and verification.',action:'Open reported repair'};
      case 'ready_to_report':return {description:'Report a problem and follow its repair.',action:'Report a problem'};
      case 'needs_intake':return {description:'Choose who will handle repair reports.',action:'Set up repairs'};
      case 'unavailable':return {description:'Review your current repair access or person link.',action:'Review repair access'};
    }
    return item.status==='working'
      ? {description:'Report a problem and follow its repair.',action:'Open repairs'}
      : {description:item.missing[0]?.reason??'Choose who will handle repair reports.',action:'Set up repairs'};
  }
  if(item.capability==='resources'&&item.resources_operation){
    switch(item.resources_operation.state){
      case 'ready_to_issue':return {description:'Start with one item, one person and a due date.',action:'Issue an item'};
      case 'loan_recorded':return {description:'Issue recorded · follow returns and questions.',action:'Open recorded loan'};
      case 'borrower_view':return {description:'Your borrowed items, due dates and questions.',action:'Open my borrowing'};
      case 'unavailable':return {description:'Review your borrowing responsibility or current person link.',action:'Review borrowing access'};
    }
  }
  if(item.capability==='fees'&&item.fees_operation){
    switch(item.fees_operation.state){
      case 'ready_to_record':return {description:'Choose people or a group. No class or term needed.',action:'Record a charge'};
      case 'charge_recorded':return item.fees_operation.scope?.kind==='batch'
        ? {description:'Charges recorded · follow payments and receipts.',action:'Open recorded charges'}
        : {description:'Charge recorded · follow payments and receipts.',action:'Open recorded charge'};
      case 'unavailable':return {description:'Review your current Finance access.',action:'Review Fees access'};
    }
  }
  if(item.capability==='assignments'&&item.assignments_operation){
    const operation=item.assignments_operation;
    if(operation.recovery==='source_changed')return {description:'This assignment changed. Review the current version.',action:'Review current assignment'};
    switch(operation.state){
      case 'requires_setup':return {description:'Start with one learning group and its people.',action:'Set up assignments'};
      case 'ready_to_create':return {description:operation.action==='view'?'Your assignments and instructor feedback.':'Choose a group to prepare your first assignment.',action:'Open assignments'};
      case 'draft':return {description:'Draft saved · not yet shared with learners.',action:'Continue your draft'};
      case 'published':return {description:'Published · follow submissions and feedback.',action:'View assignment'};
      case 'unavailable':return {description:'Review your current assignment responsibility.',action:'Review assignment access'};
    }
  }
  if(item.capability==='timetable'&&item.timetable_operation){
    const operation=item.timetable_operation;
    if(operation.recovery==='source_changed')return {description:'This activity changed. Review the current version.',action:'Review current activity'};
    if(operation.state==='unavailable')return {description:'Your saved activity is unavailable. Review your current access.',action:'Review timetable access'};
    switch(operation.state){
      case 'ready_to_create':return {description:'Schedule one activity. Attendance is optional.',action:'Schedule an activity'};
      case 'draft':return {description:'Draft saved · not yet on the timetable.',action:'Continue your draft'};
      case 'published':return {description:'Published · view the dated schedule.',action:'View scheduled activity'};
      case 'historical':return {description:'Past activity · retained with its history.',action:'View activity history'};
      case 'cancelled':return {description:'Cancelled · earlier records are retained.',action:'View cancelled activity'};
      case 'superseded':return {description:'Replaced · review the saved timetable version.',action:'View timetable version'};
    }
  }
  if (item.capability !== 'attendance' || item.status !== 'working' || !item.operation) return fallback;
  switch (item.operation.state) {
    case 'opens_later': return { description: 'Scheduled · opens when the activity starts.', action: 'View upcoming register' };
    case 'waiting_for_recorder': return { description: 'Waiting for attendance to be submitted.', action: 'View register' };
    case 'waiting_for_review': return { description: 'Submitted · awaiting review.', action: 'View submitted register' };
    case 'automatic_pending': return { description: 'Submitted · automatic finalization scheduled.', action: 'View register' };
    case 'complete': return { description: 'Final · open the saved register.', action: 'View final register' };
    case 'ready': return item.operation.action === 'review'
      ? { description: 'Submitted · ready for your review.', action: 'Review register' }
      : { description: 'Ready to record attendance.', action: 'Open register' };
    case 'requires_domain_check': return { description: 'Open your assigned register.', action: 'Open attendance' };
    default: return fallback;
  }
}
