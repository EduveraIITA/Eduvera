import {
  decodeSchoolEvent,
  SCHOOL_EVENT_TYPES,
  type SchoolEventEnvelope,
  type SchoolEventType,
} from "./schoolEventProtocol";

// Keep these names and the wire version identical to the mobile bundle. Tabs
// from /staff and the main app therefore elect one leader for the same user.
export const SCHOOL_EVENT_CHANNEL_VERSION = 1;
export const SCHOOL_EVENT_CHANNEL_PREFIX = "omnischool:school-events";
export const SCHOOL_EVENT_LOCK_PREFIX = "omnischool:school-events:leader";

export type SharedStreamStatus = "connected" | "reconnecting" | "offline";

interface ChannelMessageBase {
  version: typeof SCHOOL_EVENT_CHANNEL_VERSION;
  senderTabId: string;
  userId: string;
  targetTabId?: string;
}

export type SchoolEventChannelPayload =
  | { kind: "event"; eventType: SchoolEventType; envelope: SchoolEventEnvelope }
  | { kind: "sync" }
  | { kind: "session.expired" }
  | { kind: "status"; status: SharedStreamStatus }
  | { kind: "hello" };

export type SchoolEventChannelMessage = ChannelMessageBase & SchoolEventChannelPayload;

const eventTypeSet = new Set<string>(SCHOOL_EVENT_TYPES);
const streamStatusSet = new Set<string>(["connected", "reconnecting", "offline"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validBase(value: Record<string, unknown>) {
  return value.version === SCHOOL_EVENT_CHANNEL_VERSION
    && typeof value.senderTabId === "string" && value.senderTabId.length > 0
    && typeof value.userId === "string" && value.userId.length > 0
    && (value.targetTabId === undefined || typeof value.targetTabId === "string");
}

export function decodeSchoolEventChannelMessage(value: unknown): SchoolEventChannelMessage | null {
  if (!isRecord(value) || !validBase(value) || typeof value.kind !== "string") return null;
  const base: ChannelMessageBase = {
    version: SCHOOL_EVENT_CHANNEL_VERSION,
    senderTabId: value.senderTabId as string,
    userId: value.userId as string,
    ...(typeof value.targetTabId === "string" ? { targetTabId: value.targetTabId } : {}),
  };

  if (value.kind === "event") {
    if (typeof value.eventType !== "string" || !eventTypeSet.has(value.eventType)) return null;
    let encoded: string;
    try {
      encoded = JSON.stringify(value.envelope);
    } catch {
      return null;
    }
    const eventType = value.eventType as SchoolEventType;
    const envelope = decodeSchoolEvent(encoded, eventType);
    return envelope ? { ...base, kind: "event", eventType, envelope } : null;
  }
  if (value.kind === "status") {
    return typeof value.status === "string" && streamStatusSet.has(value.status)
      ? { ...base, kind: "status", status: value.status as SharedStreamStatus }
      : null;
  }
  if (value.kind === "sync" || value.kind === "session.expired" || value.kind === "hello") {
    return { ...base, kind: value.kind };
  }
  return null;
}

export function schoolEventChannelName(userId: string) {
  return `${SCHOOL_EVENT_CHANNEL_PREFIX}:${userId}`;
}

export function schoolEventLockName(userId: string) {
  return `${SCHOOL_EVENT_LOCK_PREFIX}:${userId}`;
}
