/** Shared declaration-only contracts used by the universal frontend.
 * Keep domain authority and HTTP execution with the owning services. */
export type Rating = 'low'|'okay'|'high'|'na';

export interface Campaign {id:string;title:string;teacher_name:string;class_name:string;audience:'students'|'parents';parameters:string[];closes_at:string;is_closed:boolean;response_count:number;submitted?:boolean}

export interface Workspace {teachers:Array<{id:string;name:string}>;classes:Array<{id:string;grade:string;section:string;academic_year:string}>;campaigns:Campaign[];default_parameters:string[]}

export interface FeedbackRound {id:string;closed_at:string;response_count:number;rated_count:number;high_percent:number}

export interface Summary {demo_preview?:boolean;minimum_responses?:number;campaign:Campaign;response_count:number;available:boolean;parameters:Array<{parameter:string;rated:number;counts:Record<Rating,number>|null;signal:string}>;activity?:Array<{date:string;count:number}>;history?:FeedbackRound[]}
