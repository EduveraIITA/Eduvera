import { describe, expect, it } from "vitest";
import { PERSON_NAME_MAX_LENGTH, personDisplayName, personNameFields } from "./personName";

describe("canonical single-name compatibility", () => {
  it.each(["Ravi", "María  del Pilar", "李 小龍", "O’Neill-Singh", "محمد علي"]) ("keeps %s whole with no inferred family-name boundary", name => {
    expect(personNameFields(`  ${name}  `)).toEqual({ first_name: name, last_name: "" });
    expect(personDisplayName(personNameFields(name))).toBe(name);
  });
  it("retains complete legacy two-part names and never silently truncates oversized input", () => {
    const first = "A".repeat(150), last = "B".repeat(150);
    expect(personDisplayName({ first_name: first, last_name: last })).toBe(`${first} ${last}`);
    expect(personNameFields(`${first} ${last}`).first_name).toHaveLength(301);
    expect(PERSON_NAME_MAX_LENGTH).toBe(150);
  });
});
