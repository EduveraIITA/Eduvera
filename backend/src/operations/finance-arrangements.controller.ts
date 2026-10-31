import { Body, Controller, ForbiddenException, Get, HttpCode, Param, Post, Query, Req } from "@nestjs/common";
import type { AuthenticatedRequest } from "../common/request.js";
import { FinanceArrangementsReadService } from "./finance-arrangements.read.js";
import { FinanceArrangementsService } from "./finance-arrangements.service.js";

@Controller("api/v1/schools/:schoolId/fees")
export class FinanceArrangementsController {
  constructor(private readonly arrangements: FinanceArrangementsService, private readonly reads: FinanceArrangementsReadService) {}
  private writable(req: AuthenticatedRequest) {
    const world = req.executionEnvironmentView;
    if (world?.mode === "simulation" && (world.unavailable || ["completed", "stopped"].includes(world.run_status ?? ""))) throw new ForbiddenException("This Simulation is read-only. Return to a working world to change an arrangement.");
  }
  @Get("arrangements/workspace/") workspace(@Req() req: AuthenticatedRequest, @Param("schoolId") schoolId: string, @Query("student_id") studentId?: string, @Query("invoice_id") invoiceId?: string, @Query("command_id") commandId?: string, @Query("person_id") personId?: string) {
    return this.reads.workspace(req.authUser, schoolId, studentId, invoiceId, commandId, personId);
  }
  @Post("invoices/:invoiceId/arrangements/request/") @HttpCode(200) request(@Req() req: AuthenticatedRequest, @Param("schoolId") schoolId: string, @Param("invoiceId") invoiceId: string, @Body() body: unknown) {
    this.writable(req); return this.arrangements.request(req.authUser, schoolId, invoiceId, body);
  }
  @Post("arrangements/:requestId/decision/") @HttpCode(200) decide(@Req() req: AuthenticatedRequest, @Param("schoolId") schoolId: string, @Param("requestId") requestId: string, @Body() body: unknown) {
    this.writable(req); return this.arrangements.decide(req.authUser, schoolId, requestId, body);
  }
  @Post("arrangements/:requestId/withdraw/") @HttpCode(200) withdraw(@Req() req: AuthenticatedRequest, @Param("schoolId") schoolId: string, @Param("requestId") requestId: string, @Body() body: unknown) {
    this.writable(req); return this.arrangements.withdraw(req.authUser, schoolId, requestId, body);
  }
  @Post("invoices/:invoiceId/self-payer/enable/") @HttpCode(200) enable(@Req() req: AuthenticatedRequest, @Param("schoolId") schoolId: string, @Param("invoiceId") invoiceId: string, @Body() body: unknown) {
    this.writable(req); return this.arrangements.enableSelfPayer(req.authUser, schoolId, invoiceId, body);
  }
  @Post("invoices/:invoiceId/self-payer/revoke/") @HttpCode(200) revoke(@Req() req: AuthenticatedRequest, @Param("schoolId") schoolId: string, @Param("invoiceId") invoiceId: string, @Body() body: unknown) {
    this.writable(req); return this.arrangements.revokeSelfPayer(req.authUser, schoolId, invoiceId, body);
  }
}
