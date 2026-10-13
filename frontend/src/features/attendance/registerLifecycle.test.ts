import { describe, expect, it } from "vitest";
import { isFinalRegister, registerLifecycleLabel, registerLifecycleState } from "./registerLifecycle";

describe("register lifecycle vocabulary", () => {
  it.each([
    ["draft", "draft", "Draft"],
    ["open", "draft", "Draft"],
    ["submitted", "submitted", "Submitted"],
    ["locked", "final", "Final"],
  ] as const)("maps %s storage state to %s", (storage, lifecycle, label) => {
    expect(registerLifecycleState(storage)).toBe(lifecycle);
    expect(registerLifecycleLabel(storage)).toBe(label);
    expect(isFinalRegister(storage)).toBe(lifecycle === "final");
  });
});
