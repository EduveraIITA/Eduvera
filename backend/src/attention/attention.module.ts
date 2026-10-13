import { Module } from "@nestjs/common";
import { ChatModule } from "../chat/chat.module.js";
import { NoticesModule } from "../notices/notices.module.js";
import { RequestsModule } from "../requests/requests.module.js";
import { AttentionController } from "./attention.controller.js";
import { AttentionService } from "./attention.service.js";
import { NotificationAttentionService } from "./notification-attention.service.js";

@Module({
  imports: [RequestsModule, NoticesModule, ChatModule],
  controllers: [AttentionController],
  providers: [AttentionService, NotificationAttentionService],
})
export class AttentionModule {}
