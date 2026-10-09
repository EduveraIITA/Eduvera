import { Controller, Get, HttpCode, Param, Post, Req, type RawBodyRequest } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { Public, SkipCsrf } from "../common/decorators.js";
import type { AuthenticatedRequest } from "../common/request.js";
import { RazorpayService } from "./razorpay.service.js";
@Controller("api/v1")
export class RazorpayController {
  constructor(private readonly payments: RazorpayService) {}
  @Post("schools/:schoolId/fees/invoices/:id/razorpay/order/")
  order(@Req() req: AuthenticatedRequest, @Param("schoolId") school: string, @Param("id") id: string) { return this.payments.create(req.authUser, school, id, req.body); }
  @Post("schools/:schoolId/fees/invoices/:id/razorpay/verify/")
  verify(@Req() req: AuthenticatedRequest, @Param("schoolId") school: string, @Param("id") id: string) { return this.payments.verify(req.authUser, school, id, req.body); }
  @Get("schools/:schoolId/fees/invoices/:id/razorpay/status/")
  status(@Req() req: AuthenticatedRequest, @Param("schoolId") school: string, @Param("id") id: string) { return this.payments.status(req.authUser, school, id); }
  @Public()
  @SkipCsrf()
  @Post("payments/razorpay/webhook/")
  @HttpCode(200)
  webhook(@Req() req: RawBodyRequest<FastifyRequest>) { return this.payments.webhook(req.rawBody, String(req.headers["x-razorpay-signature"] ?? ""), String(req.headers["x-razorpay-event-id"] ?? "")); }
}
