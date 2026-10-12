import { Module } from "@nestjs/common";
import { SchoolModule } from "../school/school.module.js";
import { NoticesController } from "./notices.controller.js";
import { NoticesService } from "./notices.service.js";

@Module({ imports: [SchoolModule], controllers: [NoticesController], providers: [NoticesService] })
export class NoticesModule {}
