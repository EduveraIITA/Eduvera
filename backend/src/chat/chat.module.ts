import { Module } from "@nestjs/common";
import { SchoolModule } from "../school/school.module.js";
import { ChatController } from "./chat.controller.js";
import { ChatService } from "./chat.service.js";
import { MatrixChatService } from "./matrix/matrix-chat.service.js";
import { MatrixController } from "./matrix/matrix.controller.js";
import { MatrixTransportService } from "./matrix/matrix-transport.service.js";

@Module({
  imports: [SchoolModule],
  controllers: [ChatController, MatrixController],
  providers: [MatrixTransportService, { provide: ChatService, useClass: MatrixChatService }],
  exports: [ChatService],
})
export class ChatModule {}
