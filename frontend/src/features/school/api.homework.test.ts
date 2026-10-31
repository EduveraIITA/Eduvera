import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "../../lib/api";
import { setHomeworkCompleted } from "./api";

vi.mock("../../lib/api", () => ({ apiFetch: vi.fn().mockResolvedValue({}) }));
beforeEach(() => vi.clearAllMocks());

describe("homework completion domain API", () => {
  it("completes the exact learner's homework through the ordinary selected-session API", async () => {
    await setHomeworkCompleted("homework-1", "learner-1", true);
    expect(apiFetch).toHaveBeenCalledWith("/api/v1/homework/homework-1/complete/", {
      method: "POST", body: JSON.stringify({ student_id: "learner-1" }),
    });
  });

  it("reopens the exact learner's homework without changing acknowledgement", async () => {
    await setHomeworkCompleted("homework-1", "learner/1", false);
    expect(apiFetch).toHaveBeenCalledWith("/api/v1/homework/homework-1/complete/?student_id=learner%2F1", { method: "DELETE" });
  });
});
