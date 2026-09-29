import { Controller, Get, HttpCode, Param, Post, Query, Req } from "@nestjs/common";
import { ApiCookieAuth, ApiTags } from "@nestjs/swagger";
import type { AuthenticatedRequest } from "../common/request.js";
import { CampusEventsService } from "./campus-events.service.js";

@ApiTags("campus events")
@ApiCookieAuth()
@Controller("api/v1/campus-events")
export class CampusEventsController {
  constructor(private readonly campusEvents: CampusEventsService) {}

  @Get("catalog")
  catalog(
    @Req() request: AuthenticatedRequest,
    @Query("school_id") schoolId: string,
  ) {
    return this.campusEvents.catalog(request.authUser, schoolId);
  }

  @Get("consent-authorities")
  consentAuthorities(
    @Req() request: AuthenticatedRequest,
    @Query("school_id") schoolId: string,
    @Query("student_id") studentId: string,
  ) {
    return this.campusEvents.consentAuthorities(request.authUser, schoolId, studentId);
  }

  @Post("consent-authorities/:relationshipId/grant")
  @HttpCode(200)
  grantConsentAuthority(
    @Req() request: AuthenticatedRequest,
    @Param("relationshipId") relationshipId: string,
  ) {
    return this.campusEvents.grantConsentAuthority(request, relationshipId, request.body);
  }

  @Post("consent-authorities/:relationshipId/revoke")
  @HttpCode(200)
  revokeConsentAuthority(
    @Req() request: AuthenticatedRequest,
    @Param("relationshipId") relationshipId: string,
  ) {
    return this.campusEvents.revokeConsentAuthority(request, relationshipId, request.body);
  }

  @Get()
  list(
    @Req() request: AuthenticatedRequest,
    @Query() query: Record<string, string | undefined>,
  ) {
    return this.campusEvents.list(request.authUser, query);
  }

  @Post()
  @HttpCode(200)
  create(@Req() request: AuthenticatedRequest) {
    return this.campusEvents.create(request, request.body);
  }

  @Get(":eventId")
  detail(
    @Req() request: AuthenticatedRequest,
    @Param("eventId") eventId: string,
    @Query("school_id") schoolId: string,
    @Query("student_id") studentId?: string,
  ) {
    return this.campusEvents.detail(request.authUser, eventId, schoolId, studentId);
  }

  @Post(":eventId/save")
  @HttpCode(200)
  save(
    @Req() request: AuthenticatedRequest,
    @Param("eventId") eventId: string,
  ) {
    return this.campusEvents.save(request, eventId, request.body);
  }

  @Post(":eventId/publish")
  @HttpCode(200)
  publish(
    @Req() request: AuthenticatedRequest,
    @Param("eventId") eventId: string,
  ) {
    return this.campusEvents.publish(request, eventId, request.body);
  }

  @Post(":eventId/cancel")
  @HttpCode(200)
  cancel(
    @Req() request: AuthenticatedRequest,
    @Param("eventId") eventId: string,
  ) {
    return this.campusEvents.cancel(request, eventId, request.body);
  }

  @Post(":eventId/complete")
  @HttpCode(200)
  complete(
    @Req() request: AuthenticatedRequest,
    @Param("eventId") eventId: string,
  ) {
    return this.campusEvents.complete(request, eventId, request.body);
  }

  @Post(":eventId/discard")
  @HttpCode(200)
  discard(
    @Req() request: AuthenticatedRequest,
    @Param("eventId") eventId: string,
  ) {
    return this.campusEvents.discard(request, eventId, request.body);
  }

  @Post(":eventId/rsvp")
  @HttpCode(200)
  rsvp(
    @Req() request: AuthenticatedRequest,
    @Param("eventId") eventId: string,
  ) {
    return this.campusEvents.rsvp(request, eventId, request.body);
  }

  @Post(":eventId/consent")
  @HttpCode(200)
  consent(
    @Req() request: AuthenticatedRequest,
    @Param("eventId") eventId: string,
  ) {
    return this.campusEvents.consent(request, eventId, request.body);
  }

  @Post(":eventId/checklist/:itemId")
  @HttpCode(200)
  checklist(
    @Req() request: AuthenticatedRequest,
    @Param("eventId") eventId: string,
    @Param("itemId") itemId: string,
  ) {
    return this.campusEvents.checklist(request, eventId, itemId, request.body);
  }

  @Get(":eventId/sessions/:sessionId/roster")
  roster(
    @Req() request: AuthenticatedRequest,
    @Param("eventId") eventId: string,
    @Param("sessionId") sessionId: string,
    @Query("school_id") schoolId: string,
  ) {
    return this.campusEvents.roster(request.authUser, eventId, sessionId, schoolId);
  }

  @Post(":eventId/sessions/:sessionId/attendance")
  @HttpCode(200)
  attendance(
    @Req() request: AuthenticatedRequest,
    @Param("eventId") eventId: string,
    @Param("sessionId") sessionId: string,
  ) {
    return this.campusEvents.attendance(request, eventId, sessionId, request.body);
  }

  @Get(":eventId/sessions/:sessionId/attendance/history")
  history(
    @Req() request: AuthenticatedRequest,
    @Param("eventId") eventId: string,
    @Param("sessionId") sessionId: string,
    @Query("school_id") schoolId: string,
  ) {
    return this.campusEvents.history(request.authUser, eventId, sessionId, schoolId);
  }

  @Post(":eventId/sessions/:sessionId/attendance/lock")
  @HttpCode(200)
  lock(
    @Req() request: AuthenticatedRequest,
    @Param("eventId") eventId: string,
    @Param("sessionId") sessionId: string,
  ) {
    return this.campusEvents.lock(request, eventId, sessionId, request.body);
  }

  @Post(":eventId/sessions/:sessionId/attendance/reopen")
  @HttpCode(200)
  reopen(
    @Req() request: AuthenticatedRequest,
    @Param("eventId") eventId: string,
    @Param("sessionId") sessionId: string,
  ) {
    return this.campusEvents.reopen(request, eventId, sessionId, request.body);
  }
}
