/** Shared declaration-only contracts used by the universal frontend.
 * Keep domain authority and HTTP execution with the owning services. */
export interface DiningRef { id: string; label: string }

export type DiningMode = "native" | "reference";

export type DiningAction = "save" | "publish" | "publish_changes" | "open" | "pause" | "resume" | "end" | "cancel" | "count" | "correct_count" | "reassign";

export interface DiningSource { label: string | null; url: string | null; reference: string | null; observed_at: string | null }

export interface DiningHistory { id: string; action?: string; actor_label: string; recorded_at: string; observed_at?: string | null; note?: string | null; reason?: string; count_total?: number | null }

export interface DiningIssue {
  id: string; session_id: string; revision: number; title: string; note?: string; state: string; handler: DiningRef; reporter: DiningRef;
  allowed_actions: string[]; history?: DiningHistory[]; history_pagination?: DiningPagination;
  session?: DiningRef & { href: string }; service?: DiningRef; place?: DiningRef | null; detail?: string; route_unavailable?: boolean;
}

export interface DiningPagination { page: number; page_size: number; has_more: boolean }

export interface DiningService {
  id: string; revision: number; name: string; coordinator: DiningRef; place: DiningRef | null; menu_mode: DiningMode;
  operations_mode: DiningMode; source: DiningSource | null; active: boolean; allowed_actions: string[];
  sessions?: DiningSession[]; history?: DiningHistory[]; history_pagination?: DiningPagination;
  sessions_pagination?: DiningPagination; has_sessions?: boolean; modes_locked?: boolean;
}

export interface DiningSession {
  recovery_only?: false;
  id: string; revision: number; label: string; state: string; service: DiningRef; coordinator: DiningRef; operator: DiningRef;
  place: DiningRef | null; starts_at: string; ends_at: string; menu_text: string; menu_mode: DiningMode; operations_mode: DiningMode;
  source: DiningSource | null; count_total: number | null; count_receipt_id: string | null; published_at: string | null;
  allowed_actions: string[]; issues?: DiningIssue[]; history?: DiningHistory[]; history_pagination?: DiningPagination;
  access_transferred?: boolean;
  route_unavailable?: boolean; availability_only?: boolean; venue_reserved?: boolean; issues_pagination?: DiningPagination;
  location_path?: DiningRef[];
}

export interface DiningRecovery { id: string; revision: number; state: string; recovery_only: true; allowed_actions: string[]; session_id?: string }

export type DiningSessionDetail = DiningSession | DiningRecovery;

export type DiningIssueDetail = DiningIssue | DiningRecovery;

export interface DiningWorkspace { services: DiningService[]; sessions: DiningSession[]; can_manage: boolean; pagination: DiningPagination; date?: string; timezone?: string }

export interface DiningOptions {
  actor?: DiningRef | null; people: Array<DiningRef & { has_app: boolean }>; spaces: DiningRef[];
  people_has_more: boolean; spaces_has_more: boolean; can_manage?: boolean;
  can_create_places?: boolean; campuses?: Array<DiningRef & { is_primary: boolean }>;
}
