import "reflect-metadata";
import { RequestMethod } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants.js";
import { describe, expect, it, vi } from "vitest";
import { ChatController } from "../src/chat/chat.controller.js";
import type { ChatService } from "../src/chat/chat.service.js";
import type { AuthenticatedRequest, AuthUser } from "../src/common/request.js";
import { PERMISSION_METADATA } from "../src/roles/permissions.js";

const reviewer = {
  id: "11111111-1111-4111-8111-111111111111",
  username: "reviewer",
  email: "reviewer@example.invalid",
  first_name: "Meera",
  last_name: "Kapoor",
  role: "admin",
  is_active: true,
  active_school_id: "22222222-2222-4222-8222-222222222222",
} as AuthUser;

function handler(name: keyof ChatController): (...arguments_: never[]) => unknown {
  const value = (ChatController.prototype as unknown as Record<string, unknown>)[name];
  if (typeof value !== "function") throw new Error(`Missing controller handler: ${String(name)}`);
  return value as (...arguments_: never[]) => unknown;
}

describe("exact safeguarding report API", () => {
  it("publishes a permission-gated report detail route", () => {
    const detail = handler("reportDetail");
    expect(Reflect.getMetadata(PATH_METADATA, detail)).toBe("reports/:reportId/");
    expect(Reflect.getMetadata(METHOD_METADATA, detail)).toBe(RequestMethod.GET);
    expect(Reflect.getMetadata(PERMISSION_METADATA, detail)).toBe("safeguarding.review");
  });

  it("forwards the signed-in reviewer and exact report id", async () => {
    const report = vi.fn().mockResolvedValue({ id: "33333333-3333-4333-8333-333333333333" });
    const controller = new ChatController({ report } as unknown as ChatService);
    const request = { authUser: reviewer } as AuthenticatedRequest;

    await expect(controller.reportDetail(request, "33333333-3333-4333-8333-333333333333"))
      .resolves.toEqual({ id: "33333333-3333-4333-8333-333333333333" });
    expect(report).toHaveBeenCalledWith(reviewer, "33333333-3333-4333-8333-333333333333");
  });
});
