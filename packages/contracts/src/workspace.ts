export type WorkspaceView = "today" | "work" | "areas" | "more";

export type WorkspaceEnvironment =
  | {
      readonly kind: "live";
      readonly namespace_id?: string | null;
      readonly virtual_now?: never;
      readonly expires_at?: never;
    }
  | {
      readonly kind: "simulation";
      readonly namespace_id: string;
      readonly virtual_now: string;
      readonly expires_at?: string | null;
    };

export interface WorkspaceContext {
  readonly actor_user_id?: string;
  readonly institution_id: string;
  readonly institution_label?: string | null;
  readonly time_zone?: string | null;
  readonly scope_label?: string | null;
  readonly date_label?: string | null;
  readonly environment: WorkspaceEnvironment;
}

export type WorkspaceTone = "neutral" | "info" | "attention" | "critical" | "success";

/**
 * A source-backed summary owned by a domain. The workspace only routes to the
 * authoritative domain surface; it never edits the record itself.
 */
export interface WorkspaceEntry {
  readonly id: string;
  readonly title: string;
  readonly detail?: string | null;
  readonly status_label?: string | null;
  readonly time_label?: string | null;
  /** Source-resolved instants and local date; localized labels are never parsed. */
  readonly starts_at?: string | null;
  readonly ends_at?: string | null;
  readonly local_date?: string | null;
  readonly href?: string | null;
  readonly action_label?: string | null;
  readonly source_label?: string | null;
  readonly source_at?: string | null;
  readonly tone?: WorkspaceTone;
}

export interface WorkspaceAttentionSummary {
  readonly total: number;
  readonly overdue: number;
  readonly due_soon: number;
}

export interface WorkspaceToday {
  readonly now: readonly WorkspaceEntry[];
  readonly attention: WorkspaceAttentionSummary;
  readonly next: readonly WorkspaceEntry[];
  readonly completed_automatically?: readonly WorkspaceEntry[];
}

export type WorkspaceWorkKind = "request" | "task" | "offer";
export type WorkspaceUrgency = "normal" | "due_soon" | "overdue" | "critical";

export interface WorkspaceWorkItem extends WorkspaceEntry {
  readonly kind: WorkspaceWorkKind;
  readonly urgency: WorkspaceUrgency;
  readonly due_label?: string | null;
  readonly href: string;
  readonly action_label: string;
  readonly direction?: "needs_me" | "waiting";
  readonly state?: "action_required" | "waiting_for_review" | "needs_reassignment" | "route_unavailable" | "review_window_ended" | "access_ended";
  readonly owner?: { readonly user_id: string | null; readonly label: string };
  readonly source?: { readonly domain: string; readonly kind: string; readonly id: string; readonly action: string; readonly revision: number | null };
  readonly core_trace?: { readonly message_ids: readonly string[] };
  readonly due_at?: string | null;
  readonly created_at?: string | null;
  readonly occurs_at?: string | null;
}

export interface WorkspaceWork {
  readonly total: number;
  readonly items: readonly WorkspaceWorkItem[];
  readonly counts?: { readonly needs_me: number; readonly waiting: number };
  readonly coverage?: "complete" | "partial";
}

export type WorkspaceIcon =
  | "attendance"
  | "building"
  | "calendar"
  | "gate"
  | "insights"
  | "messages"
  | "people"
  | "resources"
  | "facilities"
  | "accommodation"
  | "dining"
  | "simulation"
  | "settings"
  | "timetable"
  | "work";

export interface WorkspaceArea {
  readonly key: string;
  readonly label: string;
  readonly description?: string | null;
  readonly href: string;
  readonly icon?: WorkspaceIcon | null;
  readonly attention_count?: number;
  readonly capabilities: readonly string[];
  readonly scopes: readonly WorkspaceScope[];
  readonly surfaces: readonly WorkspaceAreaSurface[];
}

export type WorkspaceScopeKind =
  | "self"
  | "dependent"
  | "institution"
  | "campus"
  | "class"
  | "offering"
  | "person"
  | "event"
  | "assessment"
  | "trip"
  | "space"
  | "resource"
  | "other";

export interface WorkspaceScope {
  readonly kind: WorkspaceScopeKind;
  readonly id?: string | null;
  readonly label?: string | null;
}

export interface WorkspaceAreaSurface {
  readonly key: string;
  readonly label: string;
  readonly description?: string | null;
  readonly href: string;
  readonly capabilities: readonly string[];
  readonly scopes: readonly WorkspaceScope[];
}

export interface WorkspaceMoreItem {
  readonly key: string;
  readonly label: string;
  readonly description?: string | null;
  readonly href: string;
  readonly icon?: WorkspaceIcon | null;
  readonly capabilities?: readonly string[];
  readonly scopes?: readonly WorkspaceScope[];
}

export interface WorkspaceMoreGroup {
  readonly key: string;
  readonly label: string;
  readonly items: readonly WorkspaceMoreItem[];
}

export interface WorkspaceMore {
  /** Grouped contributions are the canonical More catalogue. */
  readonly groups?: readonly WorkspaceMoreGroup[];
  /** Compatibility fields for clients deployed before grouped contributions. */
  readonly setup: readonly WorkspaceMoreItem[];
  readonly other?: readonly WorkspaceMoreItem[];
}

export interface WorkspaceFreshness {
  readonly state: "current" | "refreshing" | "stale" | "unknown";
  readonly as_of: string;
  readonly source_revision: string;
}

export interface WorkspaceManifest {
  readonly revision: string;
  readonly generated_at: string;
  readonly context: WorkspaceContext;
  readonly today: WorkspaceToday;
  readonly work: WorkspaceWork;
  readonly areas: readonly WorkspaceArea[];
  readonly more: WorkspaceMore;
  readonly freshness: WorkspaceFreshness;
}
