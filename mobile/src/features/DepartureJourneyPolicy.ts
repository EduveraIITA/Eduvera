import type { CollectorDeparture, CollectorTrip, FamilyJourney, LocationPoint, Rider } from '../../../packages/contracts/src/wire/features/departure/api';
// Always supply the selected world’s clock to the shared pure calculations.
export { riderStops, stopFocus, coordinates as departureCoordinates } from '../../../packages/contracts/src/departure-stop-focus';
export function familyJourneyLocation(journey:FamilyJourney):LocationPoint|null {
  return journey.state==='in_progress'&&journey.rider_state==='boarded'&&journey.latitude!==null&&journey.longitude!==null&&journey.observed_at
    ?{latitude:journey.latitude,longitude:journey.longitude,accuracy_metres:journey.accuracy_metres??'0',observed_at:journey.observed_at}:null;
}

export function collectorCancellationAvailable(trip:CollectorTrip,actorId:string,schoolId:string) {
  return trip.school_id===schoolId&&trip.assigned_collector_user_id===actorId&&trip.collector_assignment_status==='accepted'
    && trip.controls_available===true&&trip.local_date===trip.service_date&&['planned','boarding'].includes(trip.state)
    && !trip.roster.some(rider=>['boarded','exception'].includes(rider.state));
}
export function collectorCancellationFingerprint(trip:CollectorTrip) {
  return JSON.stringify([trip.id,trip.school_id,trip.revision,trip.state,trip.assigned_collector_user_id,trip.collector_assignment_status,
    trip.service_date,trip.local_date,trip.controls_available,trip.roster.map(rider=>[rider.student_id,rider.revision,rider.state,rider.boarded_at,rider.dropped_at])]);
}
export function collectorCancellationBody(source:CollectorTrip,current:CollectorDeparture,actorId:string,schoolId:string,note:string) {
  const latest=current.trips.find(trip=>trip.id===source.id&&trip.school_id===schoolId);
  if(!latest||!collectorCancellationAvailable(source,actorId,schoolId)||!collectorCancellationAvailable(latest,actorId,schoolId)
    ||collectorCancellationFingerprint(source)!==collectorCancellationFingerprint(latest)) throw new Error('This journey or its rider record changed. Your reason is kept. Review the current journey before reopening cancellation.');
  if(note.trim().length<3||note.trim().length>500)throw new Error('Give a cancellation reason of 3–500 characters.');
  return {expected_revision:source.revision,note:note.trim()};
}

export function collectorRiderBody(source:CollectorTrip,rider:Rider,current:CollectorDeparture,actorId:string,schoolId:string,state:string,note:string) {
  const trip=current.trips.find(item=>item.id===source.id&&item.school_id===schoolId),latest=trip?.roster.find(item=>item.student_id===rider.student_id);
  if(!trip||trip.assigned_collector_user_id!==actorId||trip.collector_assignment_status!=='accepted'||trip.local_date!==trip.service_date
    ||trip.revision!==source.revision||trip.state!==source.state||!['boarding','in_progress'].includes(trip.state)||!latest
    ||latest.revision!==rider.revision||latest.state!==rider.state||latest.boarded_at!==rider.boarded_at||['dropped','not_riding'].includes(latest.state))
    throw new Error('This journey or rider changed. Your observation is kept. Review the current exact rider before recording.');
  if(!['boarded','not_riding','dropped','exception'].includes(state)||state===latest.state||note.trim().length>500
    ||(state==='exception'||latest.state==='exception')&&note.trim().length<3
    ||state==='not_riding'&&!!latest.boarded_at
    ||state==='dropped'&&(!latest.boarded_at||!['boarded','exception'].includes(latest.state)||trip.state!=='in_progress')
    ||state==='boarded'&&trip.direction==='from_institution'&&trip.state!=='boarding'&&latest.state!=='exception')
    throw new Error('Review the actual observed outcome and describe any concern or resolution. Location cannot establish boarding or handover.');
  return {state,expected_revision:rider.revision,note:note.trim()};
}
