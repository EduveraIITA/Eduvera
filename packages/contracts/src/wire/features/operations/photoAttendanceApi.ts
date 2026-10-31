/** Shared declaration-only contracts used by the universal frontend.
 * Keep domain authority and HTTP execution with the owning services. */
import type { AttendanceStatus } from './api';

export interface PhotoAttendanceSetup {
  enabled: boolean;
  available: boolean;
  unavailable_reason: string | null;
  accuracy_validated: false;
  role: "staff" | "admin";
  enrolled_count: number;
  class: { id: string; name: string };
  register: { state: "draft" | "submitted" | "locked"; revision: number };
  attendance: { can_mark: boolean; reason: string | null };
  students: Array<{
    student_id: string;
    name: string;
    roll_number: number;
    admission_number: string;
    avatar_url: string;
    sample_count: number;
    model_id: string | null;
    enrolled_at: string | null;
  }>;
  model: { backend: string; id: string | null; loaded: boolean } | null;
  ai_assist: {
    preview_enabled?: boolean;
    available: boolean;
    model: string | null;
    provider?: "ollama" | "vertex" | "disabled" | null;
    unavailable_reason: string | null;
  };
  boundaries: {
    liveness_proven: false;
    automatic_absence: false;
    teacher_confirmation_required: true;
    manual_register_available: true;
  };
}

export interface PhotoAttendanceAnalysis {
  id: string;
  state: "analyzed" | "applied" | "discarded" | "expired";
  class_section_id: string;
  date: string;
  period: string;
  observed_at: string;
  expires_at: string;
  model: { id: string; accuracy_validated: false };
  analysis_mode: "face_embeddings" | "local_llm" | "vertex_gemini";
  summary: {
    roster: number;
    enrolled: number;
    detected_faces: number;
    proposed_present: number;
    needs_review: number;
    elapsed_seconds: number;
  };
  warnings: string[];
  students: Array<{
    student_id: string;
    name: string;
    roll_number: number;
    admission_number: string;
    avatar_url: string;
    current_status: AttendanceStatus | null;
    sample_count: number;
    proposal: "present" | "needs_review";
    face_id: string | null;
  }>;
  faces: Array<{
    face_id: string;
    state: "auto" | "review" | "unknown" | "low_quality";
    student_id: string | null;
    student_name: string | null;
    similarity: number | null;
    thumbnail: string;
    reasons: string[];
    candidates: Array<{ student_id: string; name: string; similarity: number }>;
  }>;
}
