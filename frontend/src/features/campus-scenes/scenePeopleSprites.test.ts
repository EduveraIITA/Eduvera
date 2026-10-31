import { describe, expect, it } from "vitest";
import { scenePeopleDirection, scenePeopleSpriteFrame } from "./scenePeopleSprites";

describe("directional people sprites", () => {
  it("keeps heading continuous through wraparound and retains eight directions", () => {
    expect(Array.from({ length: 8 }, (_, index) => scenePeopleDirection(index * Math.PI / 4))).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(scenePeopleDirection(-Math.PI / 4)).toBe(7); expect(scenePeopleDirection(Math.PI * 2)).toBe(0);
  });
  it("samples deterministic staggered gait without moving an idle figure", () => {
    expect([0, 1, 2, 3].map(index => scenePeopleSpriteFrame(index * Math.PI / 2, true))).toEqual([0, 1, 2, 3]);
    expect(scenePeopleSpriteFrame(Math.PI * 30.5, false)).toBe(0);
    expect(scenePeopleSpriteFrame(-Math.PI / 2, true)).toBe(3);
  });
});
