import { Controller, Get, HttpCode, Param, Patch, Post, Query, Req } from "@nestjs/common";
import type { AuthenticatedRequest } from "../common/request.js";
import { ParticipationPeopleService } from "./participation-people.service.js";

@Controller("api/v1/schools/:schoolId/people")
export class ParticipationPeopleController {
  constructor(private readonly people: ParticipationPeopleService) {}
  @Get("participants") list(@Req() req: AuthenticatedRequest, @Param("schoolId") schoolId: string, @Query() query: Record<string, string>) { return this.people.list(req.authUser, schoolId, query); }
  @Post("participants") @HttpCode(201) create(@Req() req: AuthenticatedRequest, @Param("schoolId") schoolId: string) { return this.people.create(req, schoolId, req.body); }
  @Post("participants/name-check") @HttpCode(200) nameCheck(@Req() req: AuthenticatedRequest, @Param("schoolId") schoolId: string) { return this.people.nameCheck(req.authUser, schoolId, req.body); }
  @Get("resolve-person") resolve(@Req() req: AuthenticatedRequest, @Param("schoolId") schoolId: string, @Query() query: Record<string, string>) { return this.people.resolvePerson(req.authUser, schoolId, query); }
  @Get("participants/:id") detail(@Req() req: AuthenticatedRequest, @Param("schoolId") schoolId: string, @Param("id") id: string) { return this.people.detail(req.authUser, schoolId, id); }
  @Patch("participants/:id") correctName(@Req() req: AuthenticatedRequest, @Param("schoolId") schoolId: string, @Param("id") id: string) { return this.people.correctName(req, schoolId, id, req.body); }
  @Patch("participants/:id/profile") correctProfile(@Req() req: AuthenticatedRequest, @Param("schoolId") schoolId: string, @Param("id") id: string) { return this.people.correctProfile(req, schoolId, id, req.body); }
  @Get("participants/:id/connections") connections(@Req() req: AuthenticatedRequest, @Param("schoolId") schoolId: string, @Param("id") id: string, @Query() query: Record<string, string>) { return this.people.connections(req.authUser, schoolId, id, query); }
  @Post("participants/:id/connections") @HttpCode(201) connect(@Req() req: AuthenticatedRequest, @Param("schoolId") schoolId: string, @Param("id") id: string) { return this.people.createConnection(req, schoolId, id, req.body); }
  @Patch("connections/:id") endConnection(@Req() req: AuthenticatedRequest, @Param("schoolId") schoolId: string, @Param("id") id: string) { return this.people.endConnection(req, schoolId, id, req.body); }
  @Get("participants/:id/groups") personGroups(@Req() req: AuthenticatedRequest, @Param("schoolId") schoolId: string, @Param("id") id: string, @Query() query: Record<string, string>) { return this.people.personGroups(req.authUser, schoolId, id, query); }
  @Get("participation-groups") groups(@Req() req: AuthenticatedRequest, @Param("schoolId") schoolId: string, @Query() query: Record<string, string>) { return this.people.groups(req.authUser, schoolId, query); }
  @Get("group-catalogue") groupCatalogue(@Req() req: AuthenticatedRequest, @Param("schoolId") schoolId: string, @Query() query: Record<string, string>) { return this.people.groupCatalogue(req.authUser, schoolId, query); }
  @Get("group-catalogue/:kind/:id") nativeGroup(@Req() req: AuthenticatedRequest, @Param("schoolId") schoolId: string, @Param("kind") kind: string, @Param("id") id: string, @Query() query: Record<string, string>) { return this.people.nativeGroup(req.authUser, schoolId, kind, id, query); }
  @Post("participation-groups") @HttpCode(201) createGroup(@Req() req: AuthenticatedRequest, @Param("schoolId") schoolId: string) { return this.people.createGroup(req, schoolId, req.body); }
  @Get("participation-groups/:id") groupDetail(@Req() req: AuthenticatedRequest, @Param("schoolId") schoolId: string, @Param("id") id: string, @Query() query: Record<string, string>) { return this.people.groupDetail(req.authUser, schoolId, id, query); }
  @Get("participation-groups/:id/history") groupHistory(@Req() req: AuthenticatedRequest, @Param("schoolId") schoolId: string, @Param("id") id: string, @Query() query: Record<string, string>) { return this.people.groupMembershipHistory(req.authUser, schoolId, id, query); }
  @Post("participation-groups/:id/parent") moveGroup(@Req() req: AuthenticatedRequest, @Param("schoolId") schoolId: string, @Param("id") id: string) { return this.people.moveGroup(req, schoolId, id, req.body); }
  @Patch("participation-groups/:id/members") replace(@Req() req: AuthenticatedRequest, @Param("schoolId") schoolId: string, @Param("id") id: string) { return this.people.replaceMembers(req, schoolId, id, req.body); }
}
