/** Shared declaration-only contracts used by the universal frontend.
 * Keep domain authority and HTTP execution with the owning services. */
export interface CorrectedChargeState {
  amount_paise: number; description: string; due_on: string; charge_state: "active" | "cancelled";
  paid_paise: number; balance_paise: number; credit_paise: number;
}

export type ChargeCorrectionChange = { kind: "amend"; amount_paise?: number; description?: string; due_on?: string } | { kind: "cancel" };

export interface ChargeCorrectionQuote {
  snapshot_hash: string; today: string; person_count: number;
  items: Array<{ invoice_id: string; person_id: string; student_id: string | null; name: string; reference: string; revision: number; before: CorrectedChargeState; after: CorrectedChargeState }>;
  before_total_amount_paise: number; after_total_amount_paise: number; before_balance_paise: number; after_balance_paise: number; credit_paise: number;
}

export type PaymentCorrectionPreviewInput = { action: "reverse" } | { action: "replace"; replacement: { amount_paise: number; method: "cash" | "bank_transfer" | "cheque"; reference: string } };

export interface PaymentCorrectionQuote {
  snapshot_hash: string; today: string; invoice_id: string; payment_id: string; reference: string; amount_paise: number; method: string;
  before: CorrectedChargeState; after: CorrectedChargeState; can_reverse: boolean; can_replace: boolean;
}
