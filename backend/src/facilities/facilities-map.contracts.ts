import type { FacilitiesAssetImpact, FacilitiesState } from './facilities.types.js';

export interface FacilitiesAssetSignal {
  holding_id: string;
  state: 'unknown' | 'reported_fault' | 'awaiting_verification' | 'verified_resolution';
  impact: FacilitiesAssetImpact | null;
  open_reports: number;
  updated_at: string | null;
  repairs: Array<{ id: string; state: FacilitiesState; revision: number; target_path: string; action_label: 'Open repair' }>;
}
