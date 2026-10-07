import { Module } from "@nestjs/common";
import { SchoolModule } from "../school/school.module.js";
import { CampusEventFinanceController } from "./campus-event-finance.controller.js";
import { CampusEventFinanceService } from "./campus-event-finance.service.js";
import { CampusEventsController } from "./campus-events.controller.js";
import { CampusEventsService } from "./campus-events.service.js";

@Module({
  imports: [SchoolModule],
  controllers: [CampusEventsController, CampusEventFinanceController],
  providers: [CampusEventsService, CampusEventFinanceService],
})
export class CampusEventsModule {}
