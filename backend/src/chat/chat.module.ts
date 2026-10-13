import { Module } from "@nestjs/common";
import { SchoolModule } from "../school/school.module.js";
import { ChatController } from "./chat.controller.js";
import { ChatService } from "./chat.service.js";

@Module({ imports: [SchoolModule], controllers: [ChatController], providers: [ChatService], exports: [ChatService] })
export class ChatModule {}
