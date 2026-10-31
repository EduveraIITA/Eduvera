/** Shared declaration-only contracts used by the universal frontend.
 * Keep domain authority and HTTP execution with the owning services. */
export interface GateActivity {id:string;kind:'student'|'staff'|'visitor';person_id:string;name:string;avatar_url:string|null;detail:string;direction:'in'|'out';occurred_at:string;state:string|null}

export interface Visitor {id:string;name:string;phone?:string;purpose:string;state:'pending'|'approved'|'denied'|'inside'|'out'|'expired';school_id:string;school_name?:string;photo_url?:string|null;category?:string;host_user_id?:string|null;host_name?:string;revision:number;created_at?:string;expires_at?:string;checked_in_at?:string;checked_out_at?:string}

export type VisitorFilter = 'all'|'active'|'pending'|'approved'|'inside'|'closed';

export type VisitorCounts = Record<VisitorFilter,number>;

export interface VisitorPagination {page:number;page_size:number;total:number;total_pages:number;has_previous:boolean;has_next:boolean;filter:VisitorFilter}

export interface Workspace {office?:{name:string;phone:string}|null;visitors:Visitor[];hosts:Array<{id:string;name:string}>;pending:number;activity:GateActivity[];visitor_counts?:VisitorCounts;visitor_pagination?:VisitorPagination;focused_visitor?:Visitor|null}
