import "reflect-metadata";
import { RequestMethod } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants.js";
import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedRequest, AuthUser } from "../src/common/request.js";
import { OperationsController } from "../src/operations/operations.controller.js";
import type { FeeReviewService } from "../src/operations/fee-review.service.js";
import type { OperationsService } from "../src/operations/operations.service.js";
import { PERMISSION_METADATA } from "../src/roles/permissions.js";

const reviewer = {
  id: "11111111-1111-4111-8111-111111111111",
  username: "reviewer",
  email: "reviewer@example.invalid",
  first_name: "Meera",
  last_name: "Kapoor",
  role: "admin",
  is_active: true,
} as AuthUser;

function handler(name: keyof OperationsController): (...arguments_: never[]) => unknown {
  const value = (OperationsController.prototype as unknown as Record<string, unknown>)[name];
  if (typeof value !== "function") throw new Error(`Missing controller handler: ${String(name)}`);
  return value as (...arguments_: never[]) => unknown;
}

describe("exact gateway payment review API", () => {
  it("publishes a finance-permission-gated detail route", () => {
    const detail = handler("feeGatewayOrder");
    expect(Reflect.getMetadata(PATH_METADATA, detail)).toBe("schools/:schoolId/fees/gateway-orders/:orderId/");
    expect(Reflect.getMetadata(METHOD_METADATA, detail)).toBe(RequestMethod.GET);
    expect(Reflect.getMetadata(PERMISSION_METADATA, detail)).toBe("fees.manage");
  });

  it("forwards the current user, school and exact order id", async () => {
    const gatewayPaymentReview = vi.fn().mockResolvedValue({ id: "order-1" });
    const controller = new OperationsController(
      {} as OperationsService,
      { gatewayPaymentReview } as unknown as FeeReviewService,
    );
    const request = { authUser: reviewer } as AuthenticatedRequest;

    await expect(controller.feeGatewayOrder(request, "school-1", "order-1"))
      .resolves.toEqual({ id: "order-1" });
    expect(gatewayPaymentReview).toHaveBeenCalledWith(reviewer, "school-1", "order-1");
  });
});
