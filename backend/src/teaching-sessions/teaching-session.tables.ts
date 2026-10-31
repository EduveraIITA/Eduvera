import type { ColumnType } from "kysely";
type Instant = ColumnType<Date, Date | string, Date | string>;
export interface TeachingSessionTable {
  id: string; school_id: string; source_kind: "academic" | "activity"; logical_key: string; session_date: string;
  class_section_id: string | null; subject_id: string | null; original_teacher_id: string | null; source_fingerprint: string; source_evidence: unknown;
  revision: number; state: "prepared" | "reported"; preparation: string; topic: string; learner_notes: string;
  reported_at: Date | null; created_at: Instant; updated_at: Instant;
}
export interface TeachingSessionRevisionTable {
  school_id: string; session_id: string; revision: number; state: "prepared" | "reported"; preparation: string; topic: string;
  learner_notes: string; reason: string; source_fingerprint: string; source_evidence: unknown; command_id: string;
  actor_id: string; actor_person_id: string; recorded_at: Instant;
}
export interface TeachingSessionMaterialTable {
  id: string; school_id: string; session_id: string; title: string; kind: "link" | "text" | "file";
  url: string; body: string; shared: boolean; replaces_material_id: string | null; storage_key: string | null;
  original_name: string | null; content_type: string | null; size_bytes: number | null; sha256: string | null;
  command_id: string; created_by: string; created_at: Instant;
}
export interface TeachingSessionWorkTable {
  id:string;school_id:string;session_id:string;work_kind:"practice"|"assignment";work_id:string;practice_id:string|null;assignment_id:string|null;
  command_id:string;created_by:string;created_at:Instant;
}
export interface TeachingSessionTables { teaching_sessions: TeachingSessionTable;
  teaching_session_revisions: TeachingSessionRevisionTable; teaching_session_materials: TeachingSessionMaterialTable;teaching_session_work:TeachingSessionWorkTable }
