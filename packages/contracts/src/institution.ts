interface CatalogRecord { id: string; revision: number; updated_at: string; updated_by: string | null }

export interface Term extends CatalogRecord { name: string; academic_year: string; starts_on: string; ends_on: string; attendance_threshold: string; is_active: boolean; enrollment_count: number; timetable_count: number; register_count: number }

export interface ClassSection extends CatalogRecord { grade: string; section: string; academic_year: string; room_number: string; board: string; enrollment_count: number; timetable_count: number; assignment_count: number }

export interface Subject extends CatalogRecord { code: string; name: string; short_name: string; color: string; icon: string; timetable_count: number; attendance_count: number; diary_count: number; day_plan_count: number }

export interface Member { id: string; user_id: string; first_name: string; last_name: string; email: string; role: string; is_active: boolean }

export interface Invitation { id: string; email: string; role: string; expires_at: string; accepted_at: string | null; revoked_at: string | null }

export interface Administration {
  school: { id: string; name: string; code: string };
  students: Array<{ id: string }>;
  terms: Term[]; classes: ClassSection[]; subjects: Subject[]; members: Member[];
  invitations: Invitation[]; grants: Array<{ user_id: string; permission: string }>;
  audit: Array<{ id: string; action: string; target_id: string | null; metadata: Record<string, unknown>; created_at: string; first_name: string; last_name: string }>;
}

export interface InstitutionCampus {
  id: string; school_id: string; parent_campus_id: string | null; name: string; code: string; campus_type: "main" | "branch" | "learning_centre" | "virtual";
  status: "active" | "inactive"; is_primary: boolean; address_line: string; city: string; state: string; postal_code: string;
  timezone: string; revision: number;
}

export interface CampusSpace {
  id: string; school_id: string; campus_id: string; parent_space_id: string | null; name: string; code: string;
  kind: "building" | "hostel" | "residential_room" | "wing" | "floor" | "classroom" | "laboratory" | "library" | "office" | "auditorium" | "sports_area" | "workshop" | "staff_room" | "gate" | "outdoor_area" | "virtual" | "other";
  capacity: number | null; is_accessible: boolean; is_bookable: boolean; status: "active" | "inactive"; revision: number;
}

export interface CampusResourceType {
  id: string; school_id: string; code: string; name: string; category: "computer" | "display" | "tablet" | "lab_equipment" | "furniture" | "vehicle" | "network" | "safety" | "other";
  tracking_mode: "pooled" | "individual"; unit_label: string; is_active: boolean; revision: number;
}

export interface CampusResourceHolding {
  id: string; school_id: string; campus_id: string; space_id: string | null; resource_type_id: string; name: string;
  quantity: number; asset_tag: string | null; state: "available" | "unavailable" | "retired"; notes: string; revision: number;
  resource_type_name: string; category: CampusResourceType["category"]; tracking_mode: CampusResourceType["tracking_mode"]; unit_label: string;
}

export interface CampusObservationSource {
  id: string; kind: "device" | "integration"; external_ref: string; label: string;
  status: "active" | "suspended" | "revoked"; revision: number;
  capabilities: Array<"observe:attendance.capture" | "observe:gate.movement">;
  scope_entity_id: string | null; scope_domain: string | null; scope_domain_id: string | null; scope_label: string | null;
  updated_at: string;
}

export interface InstitutionSetup {
  school: { id: string; name: string; code: string; timezone: string; institution_kind: string };
  campuses: InstitutionCampus[]; spaces: CampusSpace[]; resource_types: CampusResourceType[]; holdings: CampusResourceHolding[];
  classes: Array<{ id: string; grade: string; section: string; academic_year: string; class_revision: number; placement_id: string | null; campus_id: string | null; home_space_id: string | null; home_space_name: string | null; placement_revision: number | null; effective_from: string | null; effective_until: string | null }>;
  staff: Array<{ id: string; first_name: string; last_name: string; staff_code: string; designation: string; status: string; assignment_id: string | null; campus_id: string | null; assignment_revision: number | null; effective_from: string | null; effective_until: string | null }>;
  activity: Array<{ id: string; kind: "setup" | "attendance"; action: string; subject_label: string | null; item_count: number; state: string; occurred_at: string; actor_label: string }>;
  signals: Array<{ id: string; kind: "expected_after_exit" | "attendance_after_exit"; severity: "review" | "important"; owner: "gate" | "attendance"; student_id: string; person_label: string; class_label: string; activity_label: string; gate_label: string; gate_observed_at: string; expected_from: string; expected_until: string; attendance_status: string | null }>;
  observation_sources: CampusObservationSource[];
  readiness: Array<{ key: string; label: string; complete: boolean; detail: string }>;
  summary: { campuses: number; spaces: number; resources: number; classes: number; classes_with_home_space: number; staff: number; complete: boolean };
}

export interface FeeStudent { id: string; admission_number: string; first_name: string; last_name: string }

export interface Invoice extends FeeStudent {
  id: string; student_id: string; reference: string; description: string; due_on: string;
  amount_paise: number; paid_paise: number; adjusted_amount_paise: number; balance_paise: number;
  refund_due_paise: number; collection_state: "collectible" | "paid" | "credited" | "refund_due" | "partially_refunded" | "refunded";
  original_due_on?: string; collection_due_on?: string | null; collection_due_amount_paise?: number | null;
  collection_overdue_paise?: number | null; collection_today?: string;
  payment_plan_state?: "none" | "active" | "satisfied" | "needs_review";
  effective_amount_paise?: number; effective_description?: string; effective_due_on?: string;
  charge_state?: "active" | "cancelled"; correction_revision?: number; can_correct?: boolean;
  charge_batch?: { id: string; reference: string; description: string; person_count: number;
    summary?: { complete: boolean; outstanding: number; cancelled: number } } | null;
  corrections?: Array<{ id: string; revision: number; reason: string; created_at: string; created_by: string;
    created_by_label?: string; actor_name?: string; actor_person_id?: string;
    amount_paise: number; description: string; due_on: string; charge_state: "active" | "cancelled" }>;
}

export interface Payment { id: string; invoice_id: string; amount_paise: number; method: string; reference: string; created_at: string;
  invoice_reference?: string; invoice_description?: string;
  status?: "active" | "reversed" | "replaced"; replaces_payment_id?: string | null; reversal_id?: string | null; replacement_payment_id?: string | null;
  correction_reason?: string | null; corrected_at?: string | null; can_reverse?: boolean; can_replace?: boolean;
  corrected_by_label?: string | null;
}

export interface GatewayPaymentReview { id: string; invoice_id: string; amount_paise: number; state: string; provider_payment_id: string | null; payment_id: string | null }

export interface FeeLedgerPagination { limit: number; payment_limit?: number; review_limit?: number; next_cursor: string | null; next_payment_cursor: string | null; next_review_cursor?: string | null; search: string; exact: boolean; grouped: boolean }

export interface FeeLedger { currency: "INR"; invoices: Invoice[]; payments: Payment[]; online_payments_enabled: boolean; gateway_payments?: GatewayPaymentReview[]; reviews?: FeeReview[]; payment_settings?: FeePaymentSettings; can_submit?: boolean;
  totals?: { billed: number; received: number; outstanding: number; refunds: number; open: number; invoices: number };
  pagination?: FeeLedgerPagination }

export interface FeeLedgerReadOptions { cursor?: string; payment_cursor?: string; review_cursor?: string; invoice_id?: string; batch_id?: string; receipt_id?: string; review_id?: string; search?: string; group_collections?: string }

export type CatalogKind = "terms" | "classes" | "subjects";

export type CatalogMutation = Record<string, unknown> & { expected_revision?: number; confirmed?: boolean; change_reason?: string };

export interface FeeReview { id: string; invoice_id: string; kind: "payment" | "charge"; amount_paise: number | null; method: string | null; reference: string | null; note: string; created_at: string; status: "pending" | "verified" | "rejected" | "answered"; decision_id?: string | null; response: string | null; payment_id: string | null; reviewed_at: string | null }

export interface FeePaymentSettings { payee_name: string; upi_id: string; instructions: string; revision: number }
