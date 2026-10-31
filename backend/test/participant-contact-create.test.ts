import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { participantCreateSchema } from "../src/people/participation-people.service.js";

describe("optional contacts on canonical person creation", () => {
  it("keeps omitted contacts absent so legacy name-only retry payloads do not change", () => {
    const key = randomUUID();
    expect(participantCreateSchema.parse({ first_name: " Mira  Khan ", idempotency_key: key }))
      .toEqual({ first_name: "Mira  Khan", last_name: "", idempotency_key: key });
    expect(participantCreateSchema.parse({ first_name: "Mira", affiliation: "worker", idempotency_key: key }))
      .toEqual({ first_name: "Mira", last_name: "", affiliation: "worker", idempotency_key: key });
  });

  it("retains optional empty contacts, email case and full saved phone text with end whitespace removed", () => {
    const key = randomUUID();
    expect(participantCreateSchema.parse({ first_name: "Mira", contact_email: "Mira.Example@example.test", contact_phone: " +91 90000 00000 ext 2 ", idempotency_key: key }))
      .toEqual({ first_name: "Mira", last_name: "", contact_email: "Mira.Example@example.test", contact_phone: "+91 90000 00000 ext 2", idempotency_key: key });
    expect(participantCreateSchema.parse({ first_name: "Mira", contact_email: "", contact_phone: " ", idempotency_key: key }))
      .toMatchObject({ contact_email: "", contact_phone: "" });
    expect(participantCreateSchema.parse({ first_name: "Mira", contact_phone: "x".repeat(32), idempotency_key: key }).contact_phone).toHaveLength(32);
    const email = `${"a".repeat(64)}@${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(61)}`;
    expect(email).toHaveLength(254);
    expect(participantCreateSchema.parse({ first_name: "Mira", contact_email: email, idempotency_key: key }).contact_email).toBe(email);
  });

  it("refuses invalid, null or unreviewed contact fields before a command can start", () => {
    const key = randomUUID(), base = { first_name: "Mira", idempotency_key: key };
    for (const fields of [{ contact_email: "invalid" }, { contact_email: " Mira@example.test " }, { contact_email: null },
      { contact_phone: null }, { contact_phone: 9000000000 }, { contact_phone: "x".repeat(33) },
      { email: "not-the-supported-field@example.test" }, { date_of_birth: "2010-01-01" }, { address: "Not supported" }]) {
      expect(() => participantCreateSchema.parse({ ...base, ...fields })).toThrow();
    }
  });
});
