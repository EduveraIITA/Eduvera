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
  clock?: {
    mode: "compressed_school_day" | "wall_clock";
    label?: string;
    duration_seconds?: number;
    scale?: number;
    started_at?: string;
    ends_at?: string;
  };
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
  control?: { enabled: boolean; changed_at: string; changed_by: "startup" | "administrator" };
}

const campusLabBase = import.meta.env.DEV ? "/__campus-lab" : "/api/v1/development/campus-simulator";

export async function getCampusLabStatus(signal?: AbortSignal): Promise<CampusLabStatus> {
  const response = await fetch(`${campusLabBase}/status`, {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
    signal,
  });
  if (!response.ok) throw new Error(response.status === 503 ? "The campus rehearsal is starting." : "The campus rehearsal is unavailable.");
  return response.json() as Promise<CampusLabStatus>;
}

export async function setCampusLabEnabled(enabled: boolean): Promise<CampusLabStatus> {
  const csrf = document.cookie.split("; ").find((item) => item.startsWith("csrftoken="))?.split("=").slice(1).join("=");
  const response = await fetch(`${campusLabBase}/control`, {
    method: "POST",
    credentials: "same-origin",
    headers: { Accept: "application/json", "Content-Type": "application/json", ...(csrf ? { "X-CSRFToken": decodeURIComponent(csrf) } : {}) },
    body: JSON.stringify({ enabled }),
  });
  if (!response.ok) throw new Error("The Cambridge simulation control is unavailable.");
  return response.json() as Promise<CampusLabStatus>;
}
