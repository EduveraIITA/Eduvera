import type {
  WorkspaceArea,
  WorkspaceAreaSurface,
  WorkspaceEntry,
  WorkspaceEnvironment,
  WorkspaceFreshness,
  WorkspaceManifest,
  WorkspaceMoreItem,
  WorkspaceMoreGroup,
  WorkspaceTone,
  WorkspaceScope,
  WorkspaceScopeKind,
  WorkspaceUrgency,
  WorkspaceWorkItem,
  WorkspaceWorkKind,
} from "./workspace";

export class WorkspaceManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceManifestError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (!isRecord(value)) throw new WorkspaceManifestError(`${name} is missing from the workspace response.`);
  return value;
}

function string(value: unknown, name: string) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new WorkspaceManifestError(`${name} is missing from the workspace response.`);
  }
  return value.trim();
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function optionalTimeZone(value: unknown) {
  const zone = optionalString(value);
  if (!zone) return null;
  try { new Intl.DateTimeFormat("en", { timeZone: zone }); }
  catch { throw new WorkspaceManifestError("context.time_zone must be a valid IANA time zone."); }
  return zone;
}

function nonNegativeNumber(value: unknown, name: string) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new WorkspaceManifestError(`${name} must be a non-negative whole number.`);
  }
  return value;
}

function list(value: unknown, name: string): unknown[] {
  if (!Array.isArray(value)) throw new WorkspaceManifestError(`${name} must be a list.`);
  return value as unknown[];
}

function internalHref(value: unknown, name: string) {
  const href = string(value, name);
  if (!href.startsWith("/") && !href.startsWith("#")) {
    throw new WorkspaceManifestError(`${name} must point to a ThatCampus screen.`);
  }
  if (href.startsWith("//")) throw new WorkspaceManifestError(`${name} must not point outside ThatCampus.`);
  return href;
}

const tones: readonly WorkspaceTone[] = ["neutral", "info", "attention", "critical", "success"];
const kinds: readonly WorkspaceWorkKind[] = ["request", "task", "offer"];
const urgencies: readonly WorkspaceUrgency[] = ["normal", "due_soon", "overdue", "critical"];

function oneOf<T extends string>(value: unknown, values: readonly T[], fallback: T): T {
  return typeof value === "string" && values.includes(value as T) ? value as T : fallback;
}

function entry(value: unknown, name: string): WorkspaceEntry {
  const item = record(value, name);
  const href = item.href === null || item.href === undefined ? null : internalHref(item.href, `${name}.href`);
  return {
    id: string(item.id, `${name}.id`),
    title: string(item.title, `${name}.title`),
    detail: optionalString(item.detail),
    status_label: optionalString(item.status_label),
    time_label: optionalString(item.time_label),
    starts_at: optionalString(item.starts_at),
    ends_at: optionalString(item.ends_at),
    local_date: optionalString(item.local_date),
    href,
    action_label: optionalString(item.action_label),
    source_label: optionalString(item.source_label),
    source_at: optionalString(item.source_at),
    tone: oneOf(item.tone, tones, "neutral"),
  };
}

function workItem(value: unknown, name: string): WorkspaceWorkItem {
  const item = record(value, name);
  const common = entry(value, name);
  return {
    ...common,
    kind: oneOf(item.kind, kinds, "task"),
    urgency: oneOf(item.urgency, urgencies, "normal"),
    due_label: optionalString(item.due_label),
    href: internalHref(item.href, `${name}.href`),
    action_label: string(item.action_label, `${name}.action_label`),
    direction: oneOf(item.direction, ["needs_me", "waiting"] as const, "needs_me"),
    ...(isRecord(item.owner) ? { owner: { user_id: optionalString(item.owner.user_id), label: string(item.owner.label, `${name}.owner.label`) } } : {}),
    ...(isRecord(item.source) ? { source: { domain: string(item.source.domain, `${name}.source.domain`), kind: string(item.source.kind, `${name}.source.kind`),
      id: string(item.source.id, `${name}.source.id`), action: string(item.source.action, `${name}.source.action`),
      revision: item.source.revision === null || item.source.revision === undefined ? null : nonNegativeNumber(item.source.revision, `${name}.source.revision`) } } : {}),
    ...(isRecord(item.core_trace) ? { core_trace: { message_ids: stringList(item.core_trace.message_ids, `${name}.core_trace.message_ids`) } } : {}),
    ...(typeof item.state === "string" && ["action_required", "waiting_for_review", "needs_reassignment", "route_unavailable", "review_window_ended", "access_ended"].includes(item.state)
      ? { state: item.state as WorkspaceWorkItem["state"] } : {}),
    due_at: optionalString(item.due_at), created_at: optionalString(item.created_at), occurs_at: optionalString(item.occurs_at),
  };
}

function stringList(value: unknown, name: string) {
  return list(value ?? [], name).map((item, index) => string(item, `${name}[${index}]`));
}

const scopeKinds: readonly WorkspaceScopeKind[] = [
  "self", "dependent", "institution", "campus", "class", "offering", "person", "event", "assessment", "trip", "space", "resource", "other",
];

function scope(value: unknown, name: string): WorkspaceScope {
  const item = record(value, name);
  const kind = string(item.kind, `${name}.kind`);
  if (!scopeKinds.includes(kind as WorkspaceScopeKind)) {
    throw new WorkspaceManifestError(`${name}.kind is not supported.`);
  }
  return {
    kind: kind as WorkspaceScopeKind,
    id: optionalString(item.id),
    label: optionalString(item.label),
  };
}

function scopes(value: unknown, name: string) {
  return list(value ?? [], name).map((item, index) => scope(item, `${name}[${index}]`));
}

function surface(value: unknown, name: string): WorkspaceAreaSurface {
  const item = record(value, name);
  return {
    key: string(item.key, `${name}.key`),
    label: string(item.label, `${name}.label`),
    description: optionalString(item.description),
    href: internalHref(item.href, `${name}.href`),
    capabilities: stringList(item.capabilities, `${name}.capabilities`),
    scopes: scopes(item.scopes, `${name}.scopes`),
  };
}

function area(value: unknown, name: string): WorkspaceArea {
  const item = record(value, name);
  const attention = item.attention_count === undefined
    ? 0
    : nonNegativeNumber(item.attention_count, `${name}.attention_count`);
  return {
    key: string(item.key, `${name}.key`),
    label: string(item.label, `${name}.label`),
    description: optionalString(item.description),
    href: internalHref(item.href, `${name}.href`),
    icon: optionalString(item.icon) as WorkspaceArea["icon"],
    attention_count: attention,
    capabilities: stringList(item.capabilities, `${name}.capabilities`),
    scopes: scopes(item.scopes, `${name}.scopes`),
    surfaces: list(item.surfaces, `${name}.surfaces`).map((entry, index) => surface(entry, `${name}.surfaces[${index}]`)),
  };
}

function moreItem(value: unknown, name: string): WorkspaceMoreItem {
  const item = record(value, name);
  return {
    key: string(item.key, `${name}.key`),
    label: string(item.label, `${name}.label`),
    description: optionalString(item.description),
    href: internalHref(item.href, `${name}.href`),
    icon: optionalString(item.icon) as WorkspaceMoreItem["icon"],
    capabilities: stringList(item.capabilities, `${name}.capabilities`),
    scopes: scopes(item.scopes, `${name}.scopes`),
  };
}

function moreGroup(value: unknown, name: string): WorkspaceMoreGroup {
  const item = record(value, name);
  return {
    key: string(item.key, `${name}.key`),
    label: string(item.label, `${name}.label`),
    items: list(item.items, `${name}.items`).map((entry, index) => moreItem(entry, `${name}.items[${index}]`)),
  };
}

function environment(value: unknown): WorkspaceEnvironment {
  const item = record(value, "context.environment");
  if (item.kind === "live") {
    return { kind: "live", namespace_id: optionalString(item.namespace_id) };
  }
  if (item.kind === "simulation") {
    return {
      kind: "simulation",
      namespace_id: string(item.namespace_id, "context.environment.namespace_id"),
      virtual_now: string(item.virtual_now, "context.environment.virtual_now"),
      expires_at: optionalString(item.expires_at),
    };
  }
  throw new WorkspaceManifestError("context.environment.kind must be live or simulation.");
}

function freshness(value: unknown): WorkspaceFreshness {
  const item = record(value, "freshness");
  return {
    state: oneOf(item.state, ["current", "refreshing", "stale", "unknown"] as const, "unknown"),
    as_of: string(item.as_of, "freshness.as_of"),
    source_revision: string(item.source_revision, "freshness.source_revision"),
  };
}

/**
 * Treats the server manifest as an API boundary rather than trusting arbitrary
 * paths or partial state. A malformed manifest fails visibly instead of
 * manufacturing a workspace from client-side role assumptions.
 */
export function normalizeWorkspaceManifest(value: unknown): WorkspaceManifest {
  const manifest = record(value, "workspace");
  const context = record(manifest.context, "context");
  const today = record(manifest.today, "today");
  const attention = record(today.attention, "today.attention");
  const work = record(manifest.work, "work");
  const more = record(manifest.more, "more");
  const completed = today.completed_automatically ?? [];

  return {
    revision: string(manifest.revision, "revision"),
    generated_at: string(manifest.generated_at, "generated_at"),
    context: {
      ...(optionalString(context.actor_user_id) ? { actor_user_id: optionalString(context.actor_user_id)! } : {}),
      institution_id: string(context.institution_id, "context.institution_id"),
      institution_label: optionalString(context.institution_label),
      time_zone: optionalTimeZone(context.time_zone),
      scope_label: optionalString(context.scope_label),
      date_label: optionalString(context.date_label),
      environment: environment(context.environment),
    },
    today: {
      now: list(today.now, "today.now").map((item, index) => entry(item, `today.now[${index}]`)),
      attention: {
        total: nonNegativeNumber(attention.total, "today.attention.total"),
        overdue: nonNegativeNumber(attention.overdue, "today.attention.overdue"),
        due_soon: nonNegativeNumber(attention.due_soon, "today.attention.due_soon"),
      },
      next: list(today.next, "today.next").map((item, index) => entry(item, `today.next[${index}]`)),
      completed_automatically: list(completed, "today.completed_automatically")
        .map((item, index) => entry(item, `today.completed_automatically[${index}]`)),
    },
    work: {
      total: nonNegativeNumber(work.total, "work.total"),
      items: list(work.items, "work.items").map((item, index) => workItem(item, `work.items[${index}]`)),
      ...(isRecord(work.counts) ? { counts: { needs_me: nonNegativeNumber(work.counts.needs_me, "work.counts.needs_me"), waiting: nonNegativeNumber(work.counts.waiting, "work.counts.waiting") } } : {}),
      ...(work.coverage === "complete" || work.coverage === "partial" ? { coverage: work.coverage } : {}),
    },
    areas: list(manifest.areas, "areas").map((item, index) => area(item, `areas[${index}]`)),
    more: (() => {
      const setup = list(more.setup ?? [], "more.setup").map((item, index) => moreItem(item, `more.setup[${index}]`));
      const other = list(more.other ?? [], "more.other").map((item, index) => moreItem(item, `more.other[${index}]`));
      const groups = more.groups === undefined
        ? [
          ...(setup.length ? [{ key: "setup", label: "Campus setup", items: setup }] : []),
          ...(other.length ? [{ key: "other", label: "Other tools", items: other }] : []),
        ]
        : list(more.groups, "more.groups").map((item, index) => moreGroup(item, `more.groups[${index}]`));
      return { groups, setup, other };
    })(),
    freshness: freshness(manifest.freshness),
  };
}

/** Server-confirmed context used by clients before revealing a projection. */
export interface WorkspaceExpectedContext {
  readonly actorUserId: string;
  readonly institutionId: string;
  readonly environment: {
    readonly mode: "live" | "simulation";
    readonly namespace_id?: string | null;
    readonly unavailable?: boolean;
  };
}

/** Prevents a retained response from crossing account, campus or world boundaries. */
export function assertWorkspaceManifestContext(manifest: WorkspaceManifest, expected: WorkspaceExpectedContext): WorkspaceManifest {
  const environment = expected.environment;
  if (!expected.actorUserId || manifest.context.actor_user_id !== expected.actorUserId
    || !expected.institutionId || manifest.context.institution_id !== expected.institutionId
    || manifest.context.environment.kind !== environment.mode
    || (environment.namespace_id && manifest.context.environment.namespace_id !== environment.namespace_id)
    || (environment.mode === "simulation" && (!environment.namespace_id || environment.unavailable))) {
    throw new WorkspaceManifestError("The workspace did not match your current account, campus and environment. Refresh to confirm your access.");
  }
  return manifest;
}
