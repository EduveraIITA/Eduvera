import { Module } from "@nestjs/common";
import { SchoolModule } from "../school/school.module.js";
import { ChatController } from "./chat.controller.js";
import { ChatService } from "./chat.service.js";
import { MatrixChatService } from "./matrix/matrix-chat.service.js";
import { MatrixController } from "./matrix/matrix.controller.js";
import { MatrixTransportService } from "./matrix/matrix-transport.service.js";
import { CampusModelCoreModule } from "../campus-model-core/campus-model-core.module.js";
import { ChatModelBridgeService } from "./chat-model-bridge.service.js";

@Module({
  imports: [SchoolModule, CampusModelCoreModule],
  controllers: [ChatController, MatrixController],
  providers: [ChatModelBridgeService, MatrixTransportService, { provide: ChatService, useClass: MatrixChatService }],
  exports: [ChatService],
})
export class ChatModule {}
