import { describe, expect, it } from "vitest";
import { campusGuidanceBackTarget } from "./AdministrationPage";

describe("native campus setup guided return", () => {
  it("returns to the exact available campus and allowed guide stage", () => {
    expect(campusGuidanceBackTarget(new URLSearchParams("setup=whole-campus&setup_step=connect&campus_id=east"), ["east", "west"]))
      .toBe("/more/setup/whole-campus?step=connect&campus_id=east");
  });
  it("does not substitute another campus for a stale or foreign identifier", () => {
    expect(campusGuidanceBackTarget(new URLSearchParams("setup=whole-campus&setup_step=connect&campus_id=foreign"), ["east"]))
      .toBe("/more/setup/whole-campus?step=find");
  });
  it("keeps ordinary setup navigation and refuses arbitrary return targets", () => {
    for (const search of ["", "setup=other&setup_step=find", "setup=whole-campus&setup_step=//outside.test", "setup=whole-campus&setup_step=/areas/people"]) {
      expect(campusGuidanceBackTarget(new URLSearchParams(search), ["east"])).toBeUndefined();
    }
    expect(campusGuidanceBackTarget(new URLSearchParams("setup=whole-campus&setup_step=find&return_to=https://outside.test"), []))
      .toBe("/more/setup/whole-campus?step=find");
  });
});
