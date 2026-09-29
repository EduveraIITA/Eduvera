import { Controller, Get, HttpCode, Param, Post, Query, Req } from "@nestjs/common";
import { ApiCookieAuth, ApiTags } from "@nestjs/swagger";
import type { AuthenticatedRequest } from "../common/request.js";
import { CampusEventFinanceService } from "./campus-event-finance.service.js";

@ApiTags("campus event finance")
@ApiCookieAuth()
@Controller("api/v1/campus-events")
export class CampusEventFinanceController {
  constructor(private readonly finance: CampusEventFinanceService) {}

  @Get(":eventId/finance")
  financeState(
    @Req() request: AuthenticatedRequest,
    @Param("eventId") eventId: string,
    @Query("school_id") schoolId: string,
    @Query("student_id") studentId?: string,
  ) {
    return this.finance.finance(request.authUser, eventId, schoolId, studentId);
  }

  @Post(":eventId/participants/:studentId/withdraw")
  @HttpCode(200)
  withdraw(
    @Req() request: AuthenticatedRequest,
    @Param("eventId") eventId: string,
    @Param("studentId") studentId: string,
  ) {
    return this.finance.withdraw(request, eventId, { ...(request.body as object), student_id: studentId });
  }

  @Post(":eventId/participants/:studentId/refunds")
  @HttpCode(200)
  refund(
    @Req() request: AuthenticatedRequest,
    @Param("eventId") eventId: string,
    @Param("studentId") studentId: string,
  ) {
    return this.finance.refund(request, eventId, { ...(request.body as object), student_id: studentId });
  }
}

