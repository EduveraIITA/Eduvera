import { describe, expect, it } from "vitest";
import { principalRegisterHistoryQueryKey } from "./attendanceQueryKeys";

describe("attendance query keys", () => {
  it("keeps daily register history isolated by class and date", () => {
    expect(principalRegisterHistoryQueryKey(null, "class-7a", "2026-10-16")).toEqual([
      "principal-register-history",
      "daily",
      "class-7a",
      "2026-10-16",
    ]);
  });

  it("keeps scheduled-session history isolated by session and date", () => {
    expect(principalRegisterHistoryQueryKey("session-physics-7a", null, "2026-10-16")).toEqual([
      "principal-register-history",
      "session",
      "session-physics-7a",
      "2026-10-16",
    ]);
  });
});
