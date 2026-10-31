var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service.js';
import { SchoolEventService } from '../../school/school-event.service.js';
import { ChatService } from '../chat.service.js';
import { MatrixTransportService } from './matrix-transport.service.js';
import { ChatModelBridgeService } from '../chat-model-bridge.service.js';
/**
 * Keep the established authorization, audit, notification, edit and report contracts.
 * PostgreSQL is the governed read projection during migration; Synapse receives a
 * transactionally enqueued, ordered event stream. Never call this an E2EE client.
 */
let MatrixChatService = class MatrixChatService extends ChatService {
    matrix;
    constructor(db, events, model, matrix) {
        super(db, events, model);
        this.matrix = matrix;
    }
    async send(user, conversationId, input, upload, request) {
        const result = await super.send(user, conversationId, input, upload, request);
        // Network calls belong in the durable worker, not the request's critical path.
        const delivery = await this.matrix.deliveryForMessages([result.id]);
        const state = delivery.get(result.id);
        return { ...result, transport: state === 'captured_in_simulation' ? 'simulation' : delivery.has(result.id) ? 'matrix' : 'legacy',
            transport_state: state ?? 'stored' };
    }
    async messages(user, conversationId, before, cursor, throughCursor) {
        const result = await super.messages(user, conversationId, before, cursor, throughCursor);
        const delivery = await this.matrix.deliveryForMessages(result.results.map(message => message.id));
        return { ...result, results: result.results.map(message => {
                const state = delivery.get(message.id);
                return { ...message, transport: state === 'captured_in_simulation' ? 'simulation' : delivery.has(message.id) ? 'matrix' : 'legacy',
                    transport_state: state ?? 'stored' };
            }) };
    }
};
MatrixChatService = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [DatabaseService, SchoolEventService, ChatModelBridgeService, MatrixTransportService])
], MatrixChatService);
export { MatrixChatService };
//# sourceMappingURL=matrix-chat.service.js.map