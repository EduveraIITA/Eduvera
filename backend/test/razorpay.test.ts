import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RazorpayClient, verifyRazorpaySignature } from "../src/operations/razorpay.client.js";
vi.mock("../src/config.js", () => ({ config: () => ({ RAZORPAY_ENABLED: true, DEMO_MODE: true, RAZORPAY_KEY_ID: "rzp_test_fixture", RAZORPAY_KEY_SECRET: "test-secret", RAZORPAY_WEBHOOK_SECRET: "webhook-secret" }) }));
afterEach(() => vi.unstubAllGlobals());
describe("Razorpay authenticity and provider boundary", () => {
  it("verifies exact order/payment bytes and rejects tampered signatures", () => {
    const signature = createHmac("sha256", "test-secret").update("order_one|pay_one").digest("hex");
    expect(() => verifyRazorpaySignature("order_one|pay_one", signature, "test-secret")).not.toThrow();
    for (const bad of ["", "x".repeat(64), signature.slice(1), "0".repeat(64)]) expect(() => verifyRazorpaySignature("order_one|pay_one", bad, "test-secret")).toThrow();
    expect(() => verifyRazorpaySignature("order_other|pay_one", signature, "test-secret")).toThrow();
  });
  it("verifies raw webhook bytes with an independent secret", () => {
    const raw = Buffer.from('{ "event": "payment.captured" }');
    const signature = createHmac("sha256", "webhook-secret").update(raw).digest("hex");
    const gateway = new RazorpayClient();
    expect(() => gateway.verifyWebhook(raw, signature)).not.toThrow();
    expect(() => gateway.verifyWebhook(Buffer.from(JSON.stringify(JSON.parse(raw.toString()))), signature)).toThrow();
    expect(() => gateway.verify("order_one", "pay_one", signature)).toThrow();
  });
  it("uses server credentials, integer paise, timeout, and fixed provider origin", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ id: "order_one" }) }); vi.stubGlobal("fetch", fetch);
    await new RazorpayClient().request("orders", { amount: 100, currency: "INR" });
    expect(fetch).toHaveBeenCalledWith("https://api.razorpay.com/v1/orders", expect.objectContaining({ method: "POST", body: '{"amount":100,"currency":"INR"}', signal: expect.any(AbortSignal) }));
  });
  it("does not leak provider responses or credentials on errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, text: () => Promise.resolve("sensitive provider response") }));
    await expect(new RazorpayClient().request("orders")).rejects.toThrow("Razorpay is unavailable");
  });
});
