import { describe, expect, it } from "vitest";
import { diningInput, diningInstant, diningTimeOptions } from "./diningTime";
import { diningSourceUrl } from "./DiningPrimitives";
describe("institution-local Dining time and source boundaries", () => {
  it("round trips Kolkata independently of the browser zone", () => { expect(diningInput("2026-10-24T07:15:00Z", "Asia/Kolkata")).toBe("2026-10-24T12:45"); expect(diningInstant("2026-10-24T12:45", "Asia/Kolkata")).toBe("2026-10-24T07:15:00.000Z"); });
  it("requires an explicit occurrence for a repeated clock hour", () => { expect(diningTimeOptions("2026-11-01T01:30", "America/New_York")).toEqual(["2026-11-01T05:30:00.000Z", "2026-11-01T06:30:00.000Z"]); expect(() => diningInstant("2026-11-01T01:30", "America/New_York")).toThrow("occurs twice"); expect(diningInstant("2026-11-01T01:30", "America/New_York", "later")).toBe("2026-11-01T06:30:00.000Z"); });
  it("rejects nonexistent clocks and invalid dates", () => { expect(diningTimeOptions("2026-03-08T02:30", "America/New_York")).toEqual([]); expect(diningTimeOptions("2026-02-30T12:00", "UTC")).toEqual([]); });
  it("retains exact observation milliseconds instead of rounding before creation", () => { const input = diningInput("2026-10-24T07:15:42.123Z", "Asia/Kolkata", true); expect(input).toBe("2026-10-24T12:45:42.123"); expect(diningInstant(input, "Asia/Kolkata")).toBe("2026-10-24T07:15:42.123Z"); });
  it("only opens HTTPS references without embedded credentials", () => { expect(diningSourceUrl("https://canteen.example/menu")).toBe("https://canteen.example/menu"); expect(diningSourceUrl("javascript:alert(1)")).toBeNull(); expect(diningSourceUrl("https://token:secret@canteen.example/")).toBeNull(); expect(diningSourceUrl("http://canteen.example/")).toBeNull(); });
});
