/** Shared declaration-only contracts used by the universal frontend.
 * Keep domain authority and HTTP execution with the owning services. */
export type DepartureMode="guardian_pickup"|"authorized_collector"|"independent_departure"|"school_transport"|"external_transport";

export interface MapConfig { tile_url:string; attribution:string }

export interface FamilyDeparture {
  service_date:string;local_date:string;can_request:boolean;journeys:FamilyJourney[];
  requests:Array<{id:string;service_date:string;status:string;requested_mode:DepartureMode;reason:string;decision_note:string;revision:number;requester_user_id:string|null;created_at:string}>;
  student:{id:string;school_id:string;first_name:string;last_name:string;admission_number:string;avatar_url:string;grade:string|null;section:string|null;school_name:string};
  children:Array<{id:string;first_name:string;last_name:string;avatar_url:string;grade:string|null;section:string|null}>;
  plan:null|{id:string;service_date:string;revision:number;mode:DepartureMode;state:string;authority_id:string|null;trip_id:string|null;stop_id:string|null;external_arrangement:string};
  request:null|{id:string;status:string;requested_mode:DepartureMode;reason:string;created_at:string};
  trip:null|{id:string;state:string;revision:number;route_name:string;route_code:string;vehicle_label:string;provider_name:string;rider_state:string;rider_revision:number;stop_name:string;planned_time:string|null;latitude:string|null;longitude:string|null;accuracy_metres:string|null;observed_at:string|null;location_fresh:boolean};
  authorities:Array<{id:string;kind:"guardian"|"collector";name:string;phone_last4:string;valid_from:string;valid_until:string|null}>; policy:{enabled:boolean;enabled_modes:DepartureMode[];change_cutoff:string};map:MapConfig;
}

export interface FamilyJourney extends NonNullable<FamilyDeparture["trip"]> {service_date:string;direction:"to_institution"|"from_institution";scheduled_departure_time:string;boarded_at:string|null;dropped_at:string|null}

export interface DeparturePolicy { school_id:string;enabled:boolean;enabled_modes:DepartureMode[];change_cutoff:string;location_retention_hours:number;location_stale_seconds:number;revision:number }

export interface RouteStop {id:string;direction:"to_institution"|"from_institution";sequence:number;name:string;planned_time:string|null;latitude:string|null;longitude:string|null}

export interface TransportRoute {id:string;code:string;name:string;service_kind:"institution_managed"|"contracted";vehicle_label:string;provider_name:string;status:string;revision:number;stops:RouteStop[]}

export interface TransportTrip {id:string;school_id:string;route_id:string;service_date:string;direction:"to_institution"|"from_institution";service_pattern_id:string|null;service_pattern_label:string|null;scheduled_departure_time:string;assigned_collector_user_id:string;backup_collector_user_id:string|null;collector_assignment_status:"pending"|"accepted"|"declined";assignment_note:string;state:"planned"|"boarding"|"in_progress"|"completed"|"cancelled";revision:number;route_name:string;route_code:string;vehicle_label:string;collector_name:string;backup_collector_name:string|null;roster_count:number;boarded_count:number;dropped_count:number;latest_location?:LocationPoint|null}

export interface TransportServicePattern {id:string;school_id:string;route_id:string;label:string;direction:"to_institution"|"from_institution";weekdays:number[];departure_time:string;primary_collector_user_id:string;backup_collector_user_id:string|null;primary_collector_name:string;backup_collector_name:string|null;valid_from:string;valid_until:string|null;status:"active"|"inactive";revision:number;route_name:string;route_code:string;vehicle_label:string}

export interface DutySwap {self_service_open?:boolean;id:string;school_id:string;request_type:"cover"|"exchange";requester_trip_id:string;target_trip_id:string|null;requester_user_id:string;target_user_id:string;requester_trip_revision:number;target_trip_revision:number|null;reason:string;status:"submitted"|"accepted"|"rejected"|"approved"|"declined_by_school"|"cancelled";response_note:string;decision_note:string;revision:number;requester_service_date:string;requester_departure_time:string;requester_route_name:string;target_service_date:string|null;target_departure_time:string|null;target_route_name:string|null;requester_name:string;target_name:string}

export interface DepartureRequest {requested_authority_id:string|null;requested_trip_id:string|null;requested_stop_id:string|null;external_arrangement:string;id:string;student_id:string;student_name:string;service_date:string;requested_mode:DepartureMode;reason:string;status:string;revision:number;created_at:string}

export interface AdminDeparture {school:{id:string;name:string;timezone:string;institution_kind:string};policy:DeparturePolicy;routes:TransportRoute[];trips:TransportTrip[];patterns:TransportServicePattern[];swaps:DutySwap[];requests:DepartureRequest[];students:Array<{id:string;admission_number:string;name:string}>;collectors:Array<{id:string;name:string;role:string}>;authorities:Array<{id:string;student_id:string;collector_name:string;revision:number;valid_from:string;valid_until:string|null}>;guardian_links:Array<{id:string;student_id:string;person_id:string;guardian_name:string;relationship:string}>;plans:Array<{id:string;student_id:string;student_name:string;service_date:string;mode:DepartureMode;state:string;revision:number;collector_name:string|null}>;map:MapConfig}

export interface Rider {student_id:string;state:"expected"|"boarded"|"dropped"|"not_riding"|"exception";revision:number;boarded_at:string|null;dropped_at:string|null;outcome_note:string;student_name:string;admission_number:string;stop_id:string;stop_name:string;stop_sequence:number;planned_time:string|null}

export interface LocationPoint {latitude:string;longitude:string;accuracy_metres:string;observed_at:string}

export interface CollectorTrip extends Omit<TransportTrip,"collector_name"|"roster_count"|"boarded_count"|"dropped_count"> {school_name:string;local_date?:string;location_fresh?:boolean;controls_open_at:string;controls_available:boolean;duty_change_available:boolean;provider_name:string;roster:Rider[];stops?:RouteStop[];latest_location:LocationPoint|null}

export interface CollectorDeparture {trips:CollectorTrip[];colleagues:Array<{school_id:string;id:string;name:string}>;swap_candidates:Array<{id:string;school_id:string;service_date:string;scheduled_departure_time:string;direction:string;assigned_collector_user_id:string;route_name:string;collector_name:string}>;swaps:DutySwap[];map:MapConfig;tracking:{foreground_only:boolean;min_interval_seconds:number}}

export interface JourneyDetail {trip:TransportTrip;roster:Rider[];history:Array<{id:string;action:string;metadata:Record<string,unknown>;created_at:string}>;location:LocationPoint|null;location_fresh:boolean;map:MapConfig}
