import { Controller, Get, HttpCode, Param, Post, Req, Res, type RawBodyRequest } from "@nestjs/common";
import type { FastifyRequest, FastifyReply } from "fastify";
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
  @Get('schools/:schoolId/fees/invoices/:id/razorpay/receipts/:receiptId/pdf/')
  async receipt(@Req() req: AuthenticatedRequest,@Param('schoolId') school:string,@Param('id') id:string,@Param('receiptId') receiptId:string,@Res() reply:FastifyReply) {
    const pdf=await this.payments.receipt(req.authUser,school,id,receiptId);
    return reply.header('Cache-Control','private, no-store').header('Content-Disposition',`attachment; filename="Eduera-test-receipt-${receiptId}.pdf"`).type('application/pdf').send(pdf);
  }
  @Public()
  @SkipCsrf()
  @Post("payments/razorpay/webhook/")
  @HttpCode(200)
  webhook(@Req() req: RawBodyRequest<FastifyRequest>) { return this.payments.webhook(req.rawBody, String(req.headers["x-razorpay-signature"] ?? ""), String(req.headers["x-razorpay-event-id"] ?? "")); }
}
