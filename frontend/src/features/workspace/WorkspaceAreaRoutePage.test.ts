import { describe, expect, it } from "vitest";
import { uniqueAreaSurfaces } from "./WorkspaceAreaRoutePage";
import type { WorkspaceAreaSurface } from "./types";

function surface(key: string, href: string): WorkspaceAreaSurface {
  return { key, label: key, href, capabilities: ["attendance.view"], scopes: [] };
}

describe("uniqueAreaSurfaces", () => {
  it("keeps self and dependent contributions that share a path but have different scope queries", () => {
    const result = uniqueAreaSurfaces([
      surface("self", "/areas/attendance/records?scope=self&student_id=student-1"),
      surface("dependent-1", "/areas/attendance/records?scope=dependent&student_id=student-2"),
      surface("dependent-2", "/areas/attendance/records?scope=dependent&student_id=student-3"),
    ]);

    expect(result.map((item) => item.key)).toEqual(["self", "dependent-1", "dependent-2"]);
  });

  it("deduplicates only an exact repeated destination", () => {
    const result = uniqueAreaSurfaces([
      surface("first", "/areas/in-out/operate"),
      surface("duplicate", "/areas/in-out/operate"),
      surface("manage", "/areas/in-out/manage"),
    ]);

    expect(result.map((item) => item.key)).toEqual(["duplicate", "manage"]);
  });
});
