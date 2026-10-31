import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Req,
  HttpCode,
} from "@nestjs/common";
import { z } from "zod";
import type { AuthenticatedRequest } from "../../common/request.js";
import { AccommodationService } from "./accommodation.service.js";
@Controller("api/v1/schools/:schoolId/facilities/accommodation")
export class AccommodationController {
  constructor(private readonly accommodation: AccommodationService) {}
  @Get("workspace") workspace(
    @Req() req: AuthenticatedRequest,
    @Param("schoolId") school: string,
    @Query() query: Record<string, string>,
  ) {
    return this.accommodation.workspace(req.authUser, school, query);
  }
  @Get("options") options(
    @Req() req: AuthenticatedRequest,
    @Param("schoolId") school: string,
    @Query() query: Record<string, string>,
  ) {
    return this.accommodation.options(req.authUser, school, query);
  }
  @Get("rooms/:id") room(
    @Req() req: AuthenticatedRequest,
    @Param("schoolId") school: string,
    @Param("id") id: string,
  ) {
    return this.accommodation.room(req.authUser, school, z.uuid().parse(id));
  }
  @Post("room-types") @HttpCode(200) saveType(
    @Req() req: AuthenticatedRequest,
    @Param("schoolId") school: string,
  ) {
    return this.accommodation.saveRoomType(req.authUser, school, req.body);
  }
  @Post("rooms") @HttpCode(200) saveRoom(
    @Req() req: AuthenticatedRequest,
    @Param("schoolId") school: string,
  ) {
    return this.accommodation.saveRoom(req.authUser, school, req.body);
  }
  @Post("places") @HttpCode(200) savePlace(
    @Req() req: AuthenticatedRequest,
    @Param("schoolId") school: string,
  ) {
    return this.accommodation.savePlace(req.authUser, school, req.body);
  }
  @Get("setup/confirmation") setupConfirmation(
    @Req() req: AuthenticatedRequest,
    @Param("schoolId") school: string,
    @Query("command_id") command: string,
  ) {
    return this.accommodation.setupConfirmation(
      req.authUser,
      school,
      z.uuid().parse(command),
    );
  }
  @Post("stays") @HttpCode(200) offer(
    @Req() req: AuthenticatedRequest,
    @Param("schoolId") school: string,
  ) {
    return this.accommodation.offer(req.authUser, school, req.body);
  }
  @Get("stays/:id") detail(
    @Req() req: AuthenticatedRequest,
    @Param("schoolId") school: string,
    @Param("id") id: string,
    @Query() query: Record<string, string>,
  ) {
    return this.accommodation.detail(
      req.authUser,
      school,
      z.uuid().parse(id),
      query,
    );
  }
  @Post("stays/:id/actions") @HttpCode(200) act(
    @Req() req: AuthenticatedRequest,
    @Param("schoolId") school: string,
    @Param("id") id: string,
  ) {
    return this.accommodation.act(
      req.authUser,
      school,
      z.uuid().parse(id),
      req.body,
    );
  }
  @Post("stays/:id/access-loans") @HttpCode(200) link(
    @Req() req: AuthenticatedRequest,
    @Param("schoolId") school: string,
    @Param("id") id: string,
  ) {
    return this.accommodation.linkAccess(
      req.authUser,
      school,
      z.uuid().parse(id),
      req.body,
    );
  }
  @Get("stays/:id/confirmation") confirmation(
    @Req() req: AuthenticatedRequest,
    @Param("schoolId") school: string,
    @Param("id") id: string,
    @Query("command_id") command: string,
  ) {
    return this.accommodation.confirmation(
      req.authUser,
      school,
      z.uuid().parse(id),
      z.uuid().parse(command),
    );
  }
}
