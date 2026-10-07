import { apiFetch } from "../../lib/api";
import type {
  CampusEventDto,
  CampusEventInput,
  CampusEventListResponse,
  CampusEventStatus,
  ConsentStatus,
  ConsentAuthorityRecord,
  EventCatalogResponse,
  EventAttendanceHistoryResponse,
  EventFinanceResponse,
  EventRegisterInput,
  EventRegisterResponse,
  RsvpStatus,
} from "./types";

export function eventIdempotencyKey() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

function query(path: string, values: Record<string, string | undefined>) {
  const parameters = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value) parameters.set(key, value);
  }
  const encoded = parameters.toString();
  return encoded ? `${path}?${encoded}` : path;
}

export interface EventListFilters {
  from?: string;
  to?: string;
  status?: CampusEventStatus;
  studentId?: string;
  cursor?: string;
  limit?: number;
}

export function getCampusEvents(schoolId: string, filters: EventListFilters = {}) {
  return apiFetch<CampusEventListResponse>(query("/api/v1/campus-events", {
    school_id: schoolId,
    from: filters.from,
    to: filters.to,
    status: filters.status,
    student_id: filters.studentId,
    cursor: filters.cursor,
    limit: filters.limit ? String(filters.limit) : undefined,
  }));
}

export function getFamilyCampusEvents(schoolId: string, studentId?: string, cursor?: string) {
  return getCampusEvents(schoolId, { studentId, cursor });
}

export function getCampusEvent(schoolId: string, eventId: string, studentId?: string) {
  return apiFetch<CampusEventDto>(query(`/api/v1/campus-events/${encodeURIComponent(eventId)}`, {
    school_id: schoolId,
    student_id: studentId,
  }));
}

export function getCampusEventFinance(schoolId: string, eventId: string, studentId?: string) {
  return apiFetch<EventFinanceResponse>(query(`/api/v1/campus-events/${encodeURIComponent(eventId)}/finance`, {
    school_id: schoolId,
    student_id: studentId,
  }));
}

export function withdrawFromPaidCampusEvent(schoolId: string, eventId: string, studentId: string, reason: string, idempotencyKey = eventIdempotencyKey()) {
  return apiFetch<EventFinanceResponse>(
    `/api/v1/campus-events/${encodeURIComponent(eventId)}/participants/${encodeURIComponent(studentId)}/withdraw`,
    {
      method: "POST",
      body: JSON.stringify({ school_id: schoolId, reason, idempotency_key: idempotencyKey }),
    },
  );
}

export function recordCampusEventRefund(schoolId: string, eventId: string, studentId: string, input: {
  amount_paise: number;
  method: "cash" | "bank_transfer" | "cheque";
  reference: string;
  reason: string;
  idempotency_key?: string;
}) {
  return apiFetch<EventFinanceResponse>(
    `/api/v1/campus-events/${encodeURIComponent(eventId)}/participants/${encodeURIComponent(studentId)}/refunds`,
    {
      method: "POST",
      body: JSON.stringify({ school_id: schoolId, ...input, idempotency_key: input.idempotency_key ?? eventIdempotencyKey() }),
    },
  );
}

export function createCampusEvent(schoolId: string, input: CampusEventInput) {
  return apiFetch<CampusEventDto>("/api/v1/campus-events", {
    method: "POST",
    body: JSON.stringify({ school_id: schoolId, idempotency_key: eventIdempotencyKey(), ...input }),
  });
}

export function saveCampusEvent(schoolId: string, eventId: string, revision: number, input: CampusEventInput) {
  return apiFetch<CampusEventDto>(`/api/v1/campus-events/${encodeURIComponent(eventId)}/save`, {
    method: "POST",
    body: JSON.stringify({
      school_id: schoolId,
      idempotency_key: eventIdempotencyKey(),
      expected_revision: revision,
      ...input,
    }),
  });
}

export function transitionCampusEvent(
  schoolId: string,
  eventId: string,
  action: "publish" | "complete" | "discard",
  revision: number,
) {
  return apiFetch<CampusEventDto>(`/api/v1/campus-events/${encodeURIComponent(eventId)}/${action}`, {
    method: "POST",
    body: JSON.stringify({ school_id: schoolId, expected_revision: revision, idempotency_key: eventIdempotencyKey() }),
  });
}

export function cancelCampusEvent(
  schoolId: string,
  eventId: string,
  revision: number,
  internalReason: string,
  audienceNotice: string,
) {
  return apiFetch<CampusEventDto>(`/api/v1/campus-events/${encodeURIComponent(eventId)}/cancel`, {
    method: "POST",
    body: JSON.stringify({
      school_id: schoolId,
      expected_revision: revision,
      internal_reason: internalReason,
      audience_notice: audienceNotice,
      idempotency_key: eventIdempotencyKey(),
    }),
  });
}

export function respondToCampusEvent(
  schoolId: string,
  eventId: string,
  studentId: string,
  status: Extract<RsvpStatus, "accepted" | "declined">,
  expectedRevision: number,
) {
  return apiFetch<CampusEventDto>(`/api/v1/campus-events/${encodeURIComponent(eventId)}/rsvp`, {
    method: "POST",
    body: JSON.stringify({ school_id: schoolId, student_id: studentId, status, expected_revision: expectedRevision, idempotency_key: eventIdempotencyKey() }),
  });
}

export function recordCampusEventConsent(
  schoolId: string,
  eventId: string,
  studentId: string,
  status: Extract<ConsentStatus, "granted" | "denied" | "withdrawn">,
  note: string,
  expectedRevision: number,
) {
  return apiFetch<CampusEventDto>(`/api/v1/campus-events/${encodeURIComponent(eventId)}/consent`, {
    method: "POST",
    body: JSON.stringify({ school_id: schoolId, student_id: studentId, status, note, expected_revision: expectedRevision, idempotency_key: eventIdempotencyKey() }),
  });
}

export function updateCampusEventChecklist(
  schoolId: string,
  eventId: string,
  itemId: string,
  studentId: string,
  completed: boolean,
) {
  return apiFetch<CampusEventDto>(`/api/v1/campus-events/${encodeURIComponent(eventId)}/checklist/${encodeURIComponent(itemId)}`, {
    method: "POST",
    body: JSON.stringify({ school_id: schoolId, student_id: studentId, completed, idempotency_key: eventIdempotencyKey() }),
  });
}

export function getCampusEventCatalog(schoolId: string) {
  return apiFetch<EventCatalogResponse>(query("/api/v1/campus-events/catalog", { school_id: schoolId }));
}

export function getEventRegister(schoolId: string, eventId: string, sessionId: string) {
  return apiFetch<EventRegisterResponse>(query(
    `/api/v1/campus-events/${encodeURIComponent(eventId)}/sessions/${encodeURIComponent(sessionId)}/roster`,
    { school_id: schoolId },
  ));
}

export function getEventRegisterHistory(schoolId: string, eventId: string, sessionId: string) {
  return apiFetch<EventAttendanceHistoryResponse>(query(
    `/api/v1/campus-events/${encodeURIComponent(eventId)}/sessions/${encodeURIComponent(sessionId)}/attendance/history`,
    { school_id: schoolId },
  ));
}

export function saveEventRegister(schoolId: string, eventId: string, sessionId: string, input: EventRegisterInput) {
  return apiFetch<EventRegisterResponse>(
    `/api/v1/campus-events/${encodeURIComponent(eventId)}/sessions/${encodeURIComponent(sessionId)}/attendance`,
    {
      method: "POST",
      body: JSON.stringify({ school_id: schoolId, ...input }),
    },
  );
}

export function changeEventRegisterLock(
  schoolId: string,
  eventId: string,
  sessionId: string,
  action: "lock" | "reopen",
  revision: number,
  reason: string,
) {
  return apiFetch<EventRegisterResponse>(
    `/api/v1/campus-events/${encodeURIComponent(eventId)}/sessions/${encodeURIComponent(sessionId)}/attendance/${action}`,
    {
      method: "POST",
      body: JSON.stringify({
        school_id: schoolId,
        expected_revision: revision,
        idempotency_key: eventIdempotencyKey(),
        reason,
      }),
    },
  );
}

export function getEventConsentAuthorities(schoolId: string, studentId: string) {
  return apiFetch<{ items: ConsentAuthorityRecord[] }>(query("/api/v1/campus-events/consent-authorities", {
    school_id: schoolId,
    student_id: studentId,
  }));
}

export function grantEventConsentAuthority(schoolId: string, relationshipId: string, input: {
  expected_revision: number;
  valid_from: string;
  valid_until: string | null;
  provenance: string;
}) {
  return apiFetch(`/api/v1/campus-events/consent-authorities/${encodeURIComponent(relationshipId)}/grant`, {
    method: "POST",
    body: JSON.stringify({ school_id: schoolId, idempotency_key: eventIdempotencyKey(), verified: true, ...input }),
  });
}

export function revokeEventConsentAuthority(schoolId: string, relationshipId: string, expectedRevision: number, reason: string) {
  return apiFetch(`/api/v1/campus-events/consent-authorities/${encodeURIComponent(relationshipId)}/revoke`, {
    method: "POST",
    body: JSON.stringify({ school_id: schoolId, expected_revision: expectedRevision, reason, idempotency_key: eventIdempotencyKey() }),
  });
}
