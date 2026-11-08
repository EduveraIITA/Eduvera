/** Shared declaration-only contracts used by the universal frontend.
 * Keep domain authority and HTTP execution with the owning services. */
import type { PublishedCampusDate } from './campusPublishedDates';

export type CalendarCategory = "milestones" | "dates" | "events" | "assessments" | "services";

export interface CalendarEntry {
  id: string;
  category: CalendarCategory;
  title: string;
  startsOn: string;
  endsOn: string;
  startsAt?: string;
  endsAt?: string;
  allDay: boolean;
  location?: string;
  status?: string;
  summary?: string;
  href?: string;
  sourceId: string;
  revision?: number;
  publication?: PublishedCampusDate;
  categoryLabel?: string;
}

export interface CampusCalendarScope {
  schoolId: string;
  timeZone: string;
  surfaceKey: string;
  studentId?: string;
  personId?: string;
  eventHref?: string;
  assessmentHref?: string;
  includeDining: boolean;
}

export interface CalendarSourceResult {
  entries: CalendarEntry[];
  partial: boolean;
}

export interface CalendarAssessmentDate {
  context_kind?: "class_term" | "learning_offering";
  offering_id?: string | null;
  subject_id?: string;
  id: string;
  title: string;
  date: string;
  scheduled_at: string;
  duration_minutes: number | null;
  venue: string;
  subject_name: string;
  class_name: string;
}
