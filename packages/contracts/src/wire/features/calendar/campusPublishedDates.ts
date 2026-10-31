/** Shared declaration-only contracts used by the universal frontend.
 * Keep domain authority and HTTP execution with the owning services. */
export interface PublishedCampusDate {
  id: string; school_id: string; title: string; description: string;
  starts_on: string; ends_on: string; category_label: string;
  state: 'published' | 'cancelled'; revision: number;
  academic_term_id: string | null;
  provenance: { fixture_key?: string; source_note?: string } | null;
  cancellation_reason?: string | null;
}

export interface PublishedCampusDatesPage {
  items: PublishedCampusDate[]; page: number; page_size: number; total: number;
  total_pages: number; from: string; until: string; can_manage: boolean;
}

export type CampusDateFields = Pick<PublishedCampusDate,
  'title' | 'description' | 'starts_on' | 'ends_on' | 'category_label' | 'academic_term_id' | 'provenance'>;
