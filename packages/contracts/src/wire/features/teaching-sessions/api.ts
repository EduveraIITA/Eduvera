/** Shared declaration-only contracts used by the universal frontend.
 * Keep domain authority and HTTP execution with the owning services. */
export interface TeachingSessionItem {
  id: string; date: string; title: string; group_label: string; starts_at: string; ends_at: string; timezone: string;
  place_label: string | null; teacher_name: string | null; original_teacher_name: string | null; is_cover: boolean;
  source_kind: "academic" | "activity"; state: "expected" | "cancelled"; source_fingerprint: string;
  lesson_state: "empty" | "prepared" | "reported"; href: string;
}

export interface TeachingLesson {
  revision: number; state: "empty" | "prepared" | "reported"; topic: string; learner_notes: string;
  preparation?: string; reported_at: string | null; updated_at: string | null;
}

export interface TeachingMaterial {
  id: string; title: string; kind: "link" | "text" | "file"; url: string | null; body: string | null;
  original_name: string | null; content_type: string | null; size_bytes: number | null; sha256: string | null;
  shared: boolean; replaces_material_id: string | null; created_at: string; download_href: string | null; source_content_omitted: boolean;
}

export interface SessionAction { href: string; label: string }

export interface SessionWorkOption { work_kind: "assignment" | "practice"; work_id: string; title: string; due_at: string | null; href: string }

export interface SessionWorkOptions { supported: boolean; reason: string | null; page: number; page_size: number; has_more: boolean; items: SessionWorkOption[] }

export interface TeachingSessionDetail {
  session: TeachingSessionItem; lesson: TeachingLesson; capabilities: { can_manage: boolean; can_read_preparation: boolean; can_link_work?: boolean };
  materials: TeachingMaterial[];
  associated_work?: Array<SessionWorkOption & { id: string }>;
  history: { items: Array<{ revision: number; state: string; topic: string; learner_notes: string; reason: string; recorded_at: string; actor_name: string; preparation?: string }>; page: number; has_more: boolean };
  previous_lesson: { id: string; date: string; topic: string; learner_notes: string; href: string } | null;
  related: { attendance: (SessionAction & { grain: "daily_class" | "scheduled_session" | "activity" }) | null; practice: SessionAction | null; assignments: SessionAction | null; schedule: SessionAction | null };
  availability_reason: string | null;
}
