import { Injectable, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";

export function verifyRazorpaySignature(body: string | Buffer, signature: string, secret: string) {
  if (!secret || !/^[a-f0-9]{64}$/i.test(signature)) throw new UnauthorizedException("Invalid payment signature.");
  const expected = createHmac("sha256", secret).update(body).digest();
  if (!timingSafeEqual(expected, Buffer.from(signature, "hex"))) throw new UnauthorizedException("Invalid payment signature.");
}
export interface RazorpayPayment { id: string; order_id: string; amount: number; currency: string; status: string; captured: boolean }
export interface RazorpayOrder { id: string; amount: number; currency: string; receipt: string }
@Injectable()
export class RazorpayClient {
  enabled() { const c = config(); return c.RAZORPAY_ENABLED && c.DEPLOYMENT_ENVIRONMENT !== "production" && c.RAZORPAY_KEY_ID.startsWith("rzp_test_") && Boolean(c.RAZORPAY_KEY_SECRET); }
  keyId() { return config().RAZORPAY_KEY_ID; }
  verify(orderId: string, paymentId: string, signature: string) { verifyRazorpaySignature(`${orderId}|${paymentId}`, signature, config().RAZORPAY_KEY_SECRET); }
  verifyWebhook(body: Buffer, signature: string) { verifyRazorpaySignature(body, signature, config().RAZORPAY_WEBHOOK_SECRET); }
  async request<T>(path: string, body?: unknown): Promise<T> {
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
