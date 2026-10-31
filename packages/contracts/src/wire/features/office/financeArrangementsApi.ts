/** Shared declaration-only contracts used by the universal frontend.
 * Keep domain authority and HTTP execution with the owning services. */
export interface ProposedInstalment { amount_paise: number; due_on: string }

export interface ArrangementRequest {
  id: string; revision: number; status: "pending" | "approved" | "rejected" | "withdrawn"; schedule: ProposedInstalment[];
  note: string; submitted_at: string; decision_response: string | null; decision_at: string | null;
  reviewer: { user_id: string; label: string }; route_state?: "waiting_for_review" | "needs_reassignment" | "route_unavailable" | "review_window_ended";
  basis_changed: boolean; can_decide: boolean; can_approve: boolean; can_withdraw: boolean;
}

export interface ArrangementInvoice {
  id: string; student_id: string | null; person_id?: string | null; context_kind?: "student" | "person"; student_label: string; reference: string; description: string; original_due_on: string;
  balance_paise: number; basis_hash: string; basis_revision: number; stream_revision: number; can_request: boolean;
  can_enable_self_payer: boolean; can_revoke_self_payer: boolean; self_payer_account_available: boolean;
  self_payer: { id: string; valid_from: string; valid_until: string; state: "active" | "scheduled" | "expired" | "revoked" } | null;
  agreement: { request_id: string; approved_at: string; state: "active" | "satisfied" | "needs_review"; next_due_on: string | null;
    rows: Array<ProposedInstalment & { allocated_paise: number | null; remaining_paise: number | null }> } | null;
  requests: ArrangementRequest[];
}

export interface FinanceArrangementsWorkspace {
  school_id: string; today: string; timezone: string; supported_mode: "approval_required"; can_manage: boolean;
  review_route: { state: "ready" | "unavailable"; reviewer: { user_id: string; label: string } | null }; invoices: ArrangementInvoice[];
  confirmation?: { state: "not_found" | "pending" | "accepted" | "not_accepted"; result?: { id: string; invoice_id: string; revision: number } };
}
