/** Shared declaration-only contracts used by the universal frontend.
 * Keep domain authority and HTTP execution with the owning services. */
export type FeeGroupKind = "participation" | "class" | "organization" | "learning";

export interface FeeAudienceSelection { person_ids: string[]; groups: Array<{ kind: FeeGroupKind; id: string }> }

export interface FeeAudiencePerson { id: string; label: string; revision: number }

export interface FeeAudienceGroup { kind: FeeGroupKind; id: string; name: string; member_count: number }

export interface FeeAudiencePage<T> { results: T[]; page: number; page_size: 25; total: number; can_add_people: boolean }

export interface FeeAudiencePreview {
  snapshot_hash: string; today: string; people: Array<{ person_id: string; name: string; revision: number }>;
  groups: FeeAudienceGroup[]; person_count: number; duplicate_count: number;
}

export interface FeeBatchResult {
  id: string; batch_id: string; reference: string; description: string; amount_paise: number; due_on: string;
  person_count: number; total_amount_paise: number; revision: 1; replayed: boolean;
  invoices: Array<{ person_id: string; invoice_id: string; reference: string; name: string }>;
}
