import { apiFetch } from "../../lib/api";
import type { AttendanceStatus } from "./api";

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
    available: boolean;
    model: string | null;
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
  analysis_mode: "face_embeddings" | "local_llm";
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

export function getPhotoAttendanceSetup(classSectionId: string, date: string) {
  const query = new URLSearchParams({ date });
  return apiFetch<PhotoAttendanceSetup>(`/api/v1/photo-attendance/classes/${encodeURIComponent(classSectionId)}/setup/?${query}`);
}

export function enrollPhotoAttendanceSample(input: {
  classSectionId: string;
  studentId: string;
  date: string;
  authorizationReference: string;
  file: File;
}) {
  const body = new FormData();
  body.set("file", input.file);
  body.set("class_section_id", input.classSectionId);
  body.set("date", input.date);
  body.set("authorization_reference", input.authorizationReference);
  body.set("confirmed_authority", "true");
  return apiFetch<{ student_id: string; added: number; sample_count: number; model_id: string }>(
    `/api/v1/photo-attendance/students/${encodeURIComponent(input.studentId)}/samples/`,
    { method: "POST", body },
  );
}

export function analyzeAttendancePhoto(input: {
  classSectionId: string;
  date: string;
  period: string;
  authorizationReference: string;
  file: File;
  useLocalAi: boolean;
}) {
  const body = new FormData();
  body.set("file", input.file);
  body.set("date", input.date);
  body.set("period", input.period);
  body.set("authorization_reference", input.authorizationReference);
  body.set("confirmed_authority", "true");
  body.set("analysis_mode", input.useLocalAi ? "local_llm" : "face_embeddings");
  return apiFetch<PhotoAttendanceAnalysis>(
    `/api/v1/photo-attendance/classes/${encodeURIComponent(input.classSectionId)}/analyze/`,
    { method: "POST", body },
  );
}
