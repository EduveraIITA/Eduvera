import "reflect-metadata";
import { RequestMethod } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants.js";
import { describe, expect, it, vi } from "vitest";
import { ChatController } from "../src/chat/chat.controller.js";
import type { ChatService } from "../src/chat/chat.service.js";
import type { AuthenticatedRequest, AuthUser } from "../src/common/request.js";
import { PERMISSION_METADATA } from "../src/roles/permissions.js";

const user = {
  id: "11111111-1111-4111-8111-111111111111",
  username: "guardian",
  email: "guardian@example.invalid",
  first_name: "Pooja",
  last_name: "Sharma",
  role: "parent",
  is_active: true,
  active_school_id: "22222222-2222-4222-8222-222222222222",
} as AuthUser;

function handler(name: keyof ChatController): (...arguments_: never[]) => unknown {
  const value = (ChatController.prototype as unknown as Record<string, unknown>)[name];
  if (typeof value !== "function") throw new Error(`Missing controller handler: ${String(name)}`);
  return value as (...arguments_: never[]) => unknown;
}

describe("exact chat conversation API", () => {
  it("publishes an authorized detail route", () => {
    const detail = handler("conversation");
    expect(Reflect.getMetadata(PATH_METADATA, detail)).toBe("conversations/:conversationId/");
    expect(Reflect.getMetadata(METHOD_METADATA, detail)).toBe(RequestMethod.GET);
    expect(Reflect.getMetadata(PERMISSION_METADATA, detail)).toBe("messages.view");
  });

  it("forwards the selected child so the service can enforce that scope", async () => {
    const conversation = vi.fn().mockResolvedValue({
      id: "33333333-3333-4333-8333-333333333333",
      title: "Aarav support",
      can_post: false,
    });
    const controller = new ChatController({ conversation } as unknown as ChatService);
    const request = { authUser: user } as AuthenticatedRequest;

    await expect(controller.conversation(
      request,
      "33333333-3333-4333-8333-333333333333",
      "44444444-4444-4444-8444-444444444444",
    )).resolves.toMatchObject({ title: "Aarav support", can_post: false });
    expect(conversation).toHaveBeenCalledWith(
      user,
      "33333333-3333-4333-8333-333333333333",
      "44444444-4444-4444-8444-444444444444",
    );
  });
});
