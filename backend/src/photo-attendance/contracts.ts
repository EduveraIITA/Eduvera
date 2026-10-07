export type PhotoProposalState = "auto" | "review" | "unknown" | "low_quality";

export interface VisionHealth {
  backend: string;
  model_loaded: boolean;
  model_id: string | null;
  model_files_present: boolean;
  missing_models: string[];
  single_operator: boolean;
  accuracy_validated: boolean;
  retention_days: number;
}

export interface VisionLlmStatus {
  available: boolean;
  installed: boolean;
  supports_images?: boolean;
  model: string;
  detail?: string;
}

export interface VisionClass {
  id: string;
  name: string;
  created: number;
  student_count?: number;
}

export interface VisionStudent {
  id: string;
  class_id: string;
  roll_number: string;
  name: string;
  authorization_record?: string;
  sample_count?: number;
  suggested_status?: "present" | "needs_review";
}

export interface VisionFace {
  face_id: string;
  student_id: string | null;
  state: PhotoProposalState;
  score: number | null;
  margin: number | null;
  conflict_margin: number | null;
  box: [number, number, number, number];
  thumbnail: string;
  reasons: string[];
  candidates: Array<{ student_id: string; score: number }>;
  quality: { ok: boolean; reasons: string[]; face_pixels: number; blur: number };
}

export interface VisionSession {
  id: string;
  class_id: string;
  attendance_date: string;
  period: string;
  version: number;
  confirmed: number;
  result: {
    model_id: string;
    analysis_mode: "face_embeddings" | "local_llm";
    roster: VisionStudent[];
    faces: VisionFace[];
    automatic_assignments: Array<{
      face_id: string;
      student_id: string;
      source: "face_embeddings" | "local_llm";
      confidence?: number;
    }>;
    summary: {
      detected_faces: number;
      auto_present: number;
      roster_needs_review: number;
      face_needs_review: number;
    };
    warnings: string[];
    elapsed_seconds: number;
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
    current_status: string | null;
    sample_count: number;
    proposal: "present" | "needs_review";
    face_id: string | null;
  }>;
  faces: Array<{
    face_id: string;
    state: PhotoProposalState;
    student_id: string | null;
    student_name: string | null;
    similarity: number | null;
    thumbnail: string;
    reasons: string[];
    candidates: Array<{ student_id: string; name: string; similarity: number }>;
  }>;
}
