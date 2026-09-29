import "reflect-metadata";
import { RequestMethod } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants.js";
import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedRequest, AuthUser } from "../src/common/request.js";
import { CampusEventsController } from "../src/campus-events/campus-events.controller.js";
import type { CampusEventsService } from "../src/campus-events/campus-events.service.js";
import {
  attendanceCommandSchema,
  createEventSchema,
} from "../src/campus-events/contracts.js";

const user = {
  id: "00000000-0000-4000-8000-000000000001",
  username: "principal",
  email: "principal@example.invalid",
  first_name: "Meera",
  last_name: "Kapoor",
  role: "admin",
  is_active: true,
  active_school_id: "00000000-0000-4000-8000-000000000002",
} as AuthUser;

function request(body: unknown): AuthenticatedRequest {
  return { authUser: user, body } as AuthenticatedRequest;
}

function handler(name: keyof CampusEventsController): (...arguments_: never[]) => unknown {
  const value = (CampusEventsController.prototype as unknown as Record<string, unknown>)[name];
  if (typeof value !== "function") throw new Error(`Missing controller handler: ${String(name)}`);
  return value as (...arguments_: never[]) => unknown;
}

describe("CampusEventsController route contract", () => {
  it("publishes one stable versioned route for every campus-event command", () => {
    expect(Reflect.getMetadata(PATH_METADATA, CampusEventsController)).toBe("api/v1/campus-events");
    const routes: Array<[keyof CampusEventsController, string, RequestMethod]> = [
      ["catalog", "catalog", RequestMethod.GET],
      ["consentAuthorities", "consent-authorities", RequestMethod.GET],
      ["grantConsentAuthority", "consent-authorities/:relationshipId/grant", RequestMethod.POST],
      ["revokeConsentAuthority", "consent-authorities/:relationshipId/revoke", RequestMethod.POST],
      ["list", "/", RequestMethod.GET],
      ["create", "/", RequestMethod.POST],
      ["detail", ":eventId", RequestMethod.GET],
      ["save", ":eventId/save", RequestMethod.POST],
      ["publish", ":eventId/publish", RequestMethod.POST],
      ["cancel", ":eventId/cancel", RequestMethod.POST],
      ["complete", ":eventId/complete", RequestMethod.POST],
      ["discard", ":eventId/discard", RequestMethod.POST],
      ["rsvp", ":eventId/rsvp", RequestMethod.POST],
      ["consent", ":eventId/consent", RequestMethod.POST],
      ["checklist", ":eventId/checklist/:itemId", RequestMethod.POST],
      ["roster", ":eventId/sessions/:sessionId/roster", RequestMethod.GET],
      ["attendance", ":eventId/sessions/:sessionId/attendance", RequestMethod.POST],
      ["history", ":eventId/sessions/:sessionId/attendance/history", RequestMethod.GET],
      ["lock", ":eventId/sessions/:sessionId/attendance/lock", RequestMethod.POST],
      ["reopen", ":eventId/sessions/:sessionId/attendance/reopen", RequestMethod.POST],
    ];

    for (const [name, path, method] of routes) {
      expect(Reflect.getMetadata(PATH_METADATA, handler(name)), name).toBe(path);
      expect(Reflect.getMetadata(METHOD_METADATA, handler(name)), name).toBe(method);
    }
  });

  it("forwards the selected child and command body without changing their meaning", async () => {
    const detail = vi.fn().mockResolvedValue({ id: "event" });
    const attendance = vi.fn().mockResolvedValue({ revision: 2 });
    const history = vi.fn().mockResolvedValue({ items: [] });
    const lock = vi.fn().mockResolvedValue({ state: "locked" });
    const service = { detail, attendance, history, lock } as unknown as CampusEventsService;
    const controller = new CampusEventsController(service);
    const body = { school_id: user.active_school_id, records: [] };
    const req = request(body);

    await controller.detail(req, "event-id", user.active_school_id!, "student-id");
    await controller.attendance(req, "event-id", "session-id");
    await controller.history(req, "event-id", "session-id", user.active_school_id!);
    await controller.lock(req, "event-id", "session-id");

    expect(detail).toHaveBeenCalledWith(user, "event-id", user.active_school_id, "student-id");
    expect(attendance).toHaveBeenCalledWith(req, "event-id", "session-id", body);
    expect(history).toHaveBeenCalledWith(user, "event-id", "session-id", user.active_school_id);
    expect(lock).toHaveBeenCalledWith(req, "event-id", "session-id", body);
  });
});

describe("Campus event input contracts", () => {
  const event = {
    school_id: "00000000-0000-4000-8000-000000000002",
    idempotency_key: "00000000-0000-4000-8000-000000000003",
    event_type: "excursion" as const,
    subject_id: null,
    title: "Science museum visit",
    description: "A guided learning visit.",
    venue: "National Science Centre",
    starts_at: "2026-10-15T03:30:00.000Z",
    ends_at: "2026-10-15T10:30:00.000Z",
    audience: {
      mode: "class_sections" as const,
      class_section_ids: ["00000000-0000-4000-8000-000000000004"],
      student_ids: [],
    },
    participation_requirement: "optional" as const,
    requires_rsvp: true,
    requires_guardian_consent: true,
    payment_required: true,
    payment_amount_paise: 125_000,
    payment_due_on: "2026-10-10",
    sessions: [{
      title: "Museum visit",
      session_type: "activity" as const,
      venue: "National Science Centre",
      starts_at: "2026-10-15T03:30:00.000Z",
      ends_at: "2026-10-15T10:30:00.000Z",
      attendance_mode: "check_in_out" as const,
      participant_student_ids: [],
    }],
    checklist: [{ label: "Carry the signed identity card", required: true }],
    staff: [],
  };

  it("accepts a paid optional event only with RSVP and internally consistent sessions", () => {
    expect(createEventSchema.parse(event)).toMatchObject({
      payment_required: true,
      requires_rsvp: true,
      payment_currency: "INR",
    });
    expect(() => createEventSchema.parse({ ...event, requires_rsvp: false })).toThrow(/requires RSVP/i);
    expect(() => createEventSchema.parse({
      ...event,
      sessions: [{ ...event.sessions[0]!, ends_at: "2026-10-16T10:30:00.000Z" }],
    })).toThrow(/event time window/i);
  });

  it("requires an RSVP workflow for free optional events too", () => {
    expect(() => createEventSchema.parse({
      ...event,
      requires_rsvp: false,
      payment_required: false,
      payment_amount_paise: null,
      payment_due_on: null,
    })).toThrow(/optional event requires RSVP/i);
  });

  it("rejects incomplete paid terms and every stray fee field on a free event", () => {
    expect(() => createEventSchema.parse({ ...event, payment_due_on: null })).toThrow(/amount and due date/i);
    expect(() => createEventSchema.parse({ ...event, payment_amount_paise: null })).toThrow(/amount and due date/i);
    expect(() => createEventSchema.parse({
      ...event,
      payment_required: false,
      payment_due_on: null,
    })).toThrow(/free events must omit both/i);
    expect(() => createEventSchema.parse({
      ...event,
      payment_required: false,
      payment_amount_paise: null,
    })).toThrow(/free events must omit both/i);
  });

  it("keeps not-recorded explicit and rejects duplicate attendance decisions", () => {
    const command = {
      school_id: event.school_id,
      expected_revision: 1,
      idempotency_key: event.idempotency_key,
      records: [{
        student_id: "00000000-0000-4000-8000-000000000005",
        status: "not_recorded",
        note: "",
        observed_at: null,
      }],
    };
    expect(attendanceCommandSchema.parse(command).records[0]?.status).toBe("not_recorded");
    expect(() => attendanceCommandSchema.parse({ ...command, records: [...command.records, ...command.records] })).toThrow(/only once/i);
  });

  it("requires an observation for physical attendance and forbids it for nonphysical decisions", () => {
    const base = {
      school_id: event.school_id,
      expected_revision: 1,
      idempotency_key: event.idempotency_key,
      records: [{
        student_id: "00000000-0000-4000-8000-000000000005",
        status: "present",
        note: "",
        observed_at: null,
      }],
    };
    expect(() => attendanceCommandSchema.parse(base)).toThrow(/observation time/i);
    expect(attendanceCommandSchema.parse({
      ...base,
      records: [{ ...base.records[0], observed_at: "2026-10-15T03:31:00.000Z" }],
    }).records[0]?.observed_at).toBe("2026-10-15T03:31:00.000Z");
    expect(() => attendanceCommandSchema.parse({
      ...base,
      records: [{ ...base.records[0], status: "excused", observed_at: "2026-10-15T03:31:00.000Z" }],
    })).toThrow(/Only a physical/i);
  });
});
