export interface ActivityRegisterSummary {
  id: string; occurrence_id: string; title: string; kind: string;
  starts_at: string; ends_at: string; time_zone: string; place_label: string | null;
  state: "draft" | "submitted" | "locked"; revision: number;
  participant_count: number; recorded_count: number; can_record: boolean; can_review: boolean;
  availability_reason: string | null; source_kind?: string;
  occurrence_state?: string; queue_category?: ActivityRegisterCategory;
  entry_mode?: "participation" | "legacy" | "owning_domain";
  source?: { domain: string; href: string; label: string };
  finalization?: { state: "automatic_pending" | "review_required"; reason: string; scheduled_at: string | null };
}
export type ActivityRegisterCategory = "needs_recording" | "awaiting_review" | "automatic_pending" | "upcoming" | "completed" | "cancelled";
