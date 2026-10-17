export type CampusLabActorRole = "student" | "staff" | "admin";

export interface CampusLabExpectedMarker {
  state?: "expected";
  basis?: "expected_from_fixture";
  source?: "cambridge_development_routine";
  source_label?: string;
  source_version?: string;
  valid_from?: string | null;
  valid_until?: string | null;
  generated_at?: string;
}

export interface CampusLabActor extends CampusLabExpectedMarker {
  id: string;
  name: string;
  role: CampusLabActorRole;
  avatar_url?: string | null;
  activity?: string;
  class_name?: string | null;
}

export interface CampusLabZone extends CampusLabExpectedMarker {
  id: string;
  space_id?: string | null;
  label: string;
  kind: string;
  activity: string;
  subject?: string | null;
  class_name?: string | null;
  actors: CampusLabActor[];
}

export interface CampusLabActivity {
  id: string;
  occurred_at: string;
  kind: "movement" | "message" | "attendance" | "notice" | "assessment" | "system" | "issue";
  title: string;
  detail: string;
  state: "expected" | "recorded" | "issue";
  evidence_scope?: "planned_rehearsal_only" | "domain_record_only";
  spatial_evidence?: false;
  target_path?: string | null;
}

export interface CampusLabSchedule {
  reference_weekday: number | null;
  reference_date: string | null;
  simulated_at: string | null;
  source: "effective_school_schedule";
  active_slot_ids: string[];
}

export interface CampusLabStatus {
  status: "booting" | "running" | "paused" | "degraded";
  generated_at: string;
  started_at: string;
  school: { id: string; name: string; code: string } | null;
  phase: {
    id: string;
    label: string;
    description: string;
    started_at?: string;
    mode?: "lesson" | "break" | "activity" | "transition" | "closed";
    period_number?: number | null;
    school_starts_at?: string | null;
    school_ends_at?: string | null;
    next_change_at: string | null;
  } | null;
  schedule?: CampusLabSchedule | null;
  summary: { actors: number; students: number; staff: number; zones: number };
  zones: CampusLabZone[];
  activity: CampusLabActivity[];
  errors?: string[];
}

export async function getCampusLabStatus(signal?: AbortSignal): Promise<CampusLabStatus> {
  const response = await fetch("/__campus-lab/status", {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
    signal,
  });
  if (!response.ok) throw new Error(response.status === 503 ? "The local campus rehearsal is starting." : "The local campus rehearsal is unavailable.");
  return response.json() as Promise<CampusLabStatus>;
}
