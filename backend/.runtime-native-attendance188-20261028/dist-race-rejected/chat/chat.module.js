var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { Module } from "@nestjs/common";
import { SchoolModule } from "../school/school.module.js";
import { ChatController } from "./chat.controller.js";
import { ChatService } from "./chat.service.js";
import { MatrixChatService } from "./matrix/matrix-chat.service.js";
import { MatrixController } from "./matrix/matrix.controller.js";
import { MatrixTransportService } from "./matrix/matrix-transport.service.js";
import { CampusModelCoreModule } from "../campus-model-core/campus-model-core.module.js";
import { ChatModelBridgeService } from "./chat-model-bridge.service.js";
let ChatModule = class ChatModule {
};
ChatModule = __decorate([
    Module({
        imports: [SchoolModule, CampusModelCoreModule],
        controllers: [ChatController, MatrixController],
        providers: [ChatModelBridgeService, MatrixTransportService, { provide: ChatService, useClass: MatrixChatService }],
        exports: [ChatService, MatrixTransportService],
    })
], ChatModule);
export { ChatModule };
//# sourceMappingURL=chat.module.js.map