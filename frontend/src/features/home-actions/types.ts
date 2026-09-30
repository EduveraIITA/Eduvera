export type HomeActionPriority = "urgent" | "high" | "normal" | "info";

export type HomeActionKind =
  | "event_rsvp"
  | "event_consent"
  | "event_payment"
  | "event_checklist"
  | "event_upcoming"
  | "leave_signature"
  | "diary_acknowledgement"
  | "attendance_register"
  | "attendance_followup"
  | "event_duty";

export interface HomeAction {
  id: string;
  kind: HomeActionKind;
  priority: HomeActionPriority;
  title: string;
  detail: string;
  status_label: string;
  action_label: string;
  href: string;
  source_id: string;
  occurs_at: string | null;
  due_at: string | null;
}
