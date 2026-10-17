import { describe, expect, it } from "vitest";

import { profileAvatar } from "./profileAvatars";

describe("profileAvatar", () => {
  it("uses only the portrait recorded by the server", () => {
    expect(profileAvatar(" /uploads/student.jpg "))
      .toBe("/uploads/student.jpg");
  });

  it("does not invent a demo portrait when no portrait is recorded", () => {
    expect(profileAvatar(null)).toBeUndefined();
    expect(profileAvatar("")).toBeUndefined();
  });
});
