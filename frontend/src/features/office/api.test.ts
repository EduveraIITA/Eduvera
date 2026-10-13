import { beforeEach, describe, expect, it, vi } from "vitest";
import { getGatewayPaymentReview } from "./api";

const apiFetchMock = vi.hoisted(() => vi.fn());
vi.mock("../../lib/api", () => ({ apiFetch: apiFetchMock }));

beforeEach(() => apiFetchMock.mockReset());

describe("exact gateway payment review API", () => {
  it("encodes the school and order identifiers in the exact endpoint", async () => {
    apiFetchMock.mockResolvedValue({});

    await getGatewayPaymentReview("school/one", "order/two");

    expect(apiFetchMock).toHaveBeenCalledWith(
      "/api/v1/schools/school%2Fone/fees/gateway-orders/order%2Ftwo/",
    );
  });
});
