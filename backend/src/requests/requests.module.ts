import { Module } from "@nestjs/common";
import { SchoolModule } from "../school/school.module.js";
import { RequestsController } from "./requests.controller.js";
import { RequestsService } from "./requests.service.js";

@Module({ imports: [SchoolModule], controllers: [RequestsController], providers: [RequestsService] })
export class RequestsModule {}
