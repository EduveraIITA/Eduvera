/** Shared declaration-only contracts used by the universal frontend.
 * Keep domain authority and HTTP execution with the owning services. */
import type { SchedulePeriod } from '../../../schedule-period';
import type { PrincipalTimetableResponse } from '../operations/api';

export interface ScheduleVersion { id:string; class_section_id:string; term_id:string; state:'draft'|'published'; starts_on:string; ends_on:string; revision:number; baseline:boolean; periods:SchedulePeriod[]; }

export interface ScheduleScreen extends PrincipalTimetableResponse { school_id:string; versions:ScheduleVersion[]; }
