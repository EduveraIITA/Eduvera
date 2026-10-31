import { Injectable, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";
import { assertLiveExternalEffect } from "../common/simulation-effects.js";
import { captureSimulationProviderEffect, selectedSimulationResources, simulationLogicalDigest } from "../common/simulation-resources.js";

export function verifyRazorpaySignature(body: string | Buffer, signature: string, secret: string) {
  if (!secret || !/^[a-f0-9]{64}$/i.test(signature)) throw new UnauthorizedException("Invalid payment signature.");
  const expected = createHmac("sha256", secret).update(body).digest();
  if (!timingSafeEqual(expected, Buffer.from(signature, "hex"))) throw new UnauthorizedException("Invalid payment signature.");
}
export interface RazorpayPayment { id: string; order_id: string; amount: number; currency: string; status: string; captured: boolean; created_at?:number }
export interface RazorpayOrder { id: string; amount: number; currency: string; receipt: string }
@Injectable()
export class RazorpayClient {
  enabled() { if (selectedSimulationResources()) return true; const c = config(); return c.RAZORPAY_ENABLED && c.DEPLOYMENT_ENVIRONMENT !== "production" && c.RAZORPAY_KEY_ID.startsWith("rzp_test_") && Boolean(c.RAZORPAY_KEY_SECRET); }
  keyId() { if (selectedSimulationResources()) return "simulation_no_external_checkout"; return config().RAZORPAY_KEY_ID; }
  verify(orderId: string, paymentId: string, signature: string) { assertLiveExternalEffect("Payment signature verification"); verifyRazorpaySignature(`${orderId}|${paymentId}`, signature, config().RAZORPAY_KEY_SECRET); }
  verifyWebhook(body: Buffer, signature: string) { assertLiveExternalEffect("Payment webhook verification"); verifyRazorpaySignature(body, signature, config().RAZORPAY_WEBHOOK_SECRET); }
  async request<T>(path: string, body?: unknown): Promise<T> {
    const selected = selectedSimulationResources();
    if (selected) {
      if (path === "orders" && body && typeof body === "object") {
        const order = body as { amount?: unknown; currency?: unknown; receipt?: unknown };
        if (!Number.isSafeInteger(order.amount) || Number(order.amount) < 100 || order.currency !== "INR"
          || typeof order.receipt !== "string" || !/^[a-f0-9-]{36}$/u.test(order.receipt)) {
          throw new ServiceUnavailableException("The isolated payment-order request is invalid.");
        }
        const value = { ...order, id: `order_sim_${simulationLogicalDigest(`${selected.environment.run_id}:${order.receipt}`).slice(0, 24)}` };
        await selected.artifacts.write(simulationLogicalDigest(`payment-order:${value.id}`), Buffer.from(JSON.stringify(value)), false);
        await captureSimulationProviderEffect({ kind: "connector_call", provider: "payment", operation: "create_order",
          logicalKey: order.receipt, idempotencyKey: `payment-order:${order.receipt}`,
          payload: { amount: Number(order.amount), currency: "INR", evidence_mode: "simulation", money_moved: false, status: "pending" } });
        return value as T;
      }
      if (/^orders\/[A-Za-z0-9_]+\/payments$/u.test(path) && !body) {
        // The adapter never manufactures a successful payment, signature or
        // capture. Native manual ledger scenarios remain explicit admin edits.
        await captureSimulationProviderEffect({ kind: "connector_call", provider: "payment", operation: "check_status",
          logicalKey: path, payload: { evidence_mode: "simulation", money_moved: false, status: "pending" } });
        return { items: [] } as T;
      }
      throw new ServiceUnavailableException("This payment operation has no reviewed isolated substitute. No provider was contacted.");
    }
    assertLiveExternalEffect("Payment provider access");
    if (!this.enabled()) throw new ServiceUnavailableException("Razorpay sandbox is not configured.");
    const c = config();
    try {
      const response = await fetch(`https://api.razorpay.com/v1/${path}`, {
        method: body ? "POST" : "GET", signal: AbortSignal.timeout(12000),
        headers: { Authorization: `Basic ${Buffer.from(`${c.RAZORPAY_KEY_ID}:${c.RAZORPAY_KEY_SECRET}`).toString("base64")}`, "Content-Type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (!response.ok) throw new Error("Provider request failed");
      return await response.json() as T;
    } catch { throw new ServiceUnavailableException("Razorpay is unavailable. Check payment status before trying again."); }
  }
}
