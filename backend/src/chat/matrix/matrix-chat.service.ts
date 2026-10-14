import { Injectable } from '@nestjs/common';
import type { AuthenticatedRequest, AuthUser } from '../../common/request.js';
import { DatabaseService } from '../../database/database.service.js';
import { SchoolEventService } from '../../school/school-event.service.js';
import { ChatService, type ChatUpload } from '../chat.service.js';
import { MatrixTransportService } from './matrix-transport.service.js';

/**
 * Keep the established authorization, audit, notification, edit and report contracts.
 * PostgreSQL is the governed read projection during migration; Synapse receives a
 * transactionally enqueued, ordered event stream. Never call this an E2EE client.
 */
@Injectable()
export class MatrixChatService extends ChatService {
  constructor(db: DatabaseService, events: SchoolEventService, private readonly matrix: MatrixTransportService) {
    super(db, events);
  }
  override async send(user: AuthUser, conversationId: string, input: unknown, upload: ChatUpload | undefined, request: AuthenticatedRequest) {
    const result = await super.send(user,conversationId,input,upload,request);
    // Network calls belong in the durable worker, not the request's critical path.
    const delivery = await this.matrix.deliveryForMessages([result.id]);
    return { ...result, transport: delivery.has(result.id) ? 'matrix' : 'legacy',
      transport_state: delivery.get(result.id) ?? 'stored' };
  }
  override async messages(user: AuthUser, conversationId: string, before?: string) {
    const result = await super.messages(user,conversationId,before);
    const delivery = await this.matrix.deliveryForMessages(result.results.map(message => message.id));
    return { ...result, results: result.results.map(message => ({ ...message,
      transport: delivery.has(message.id) ? 'matrix' : 'legacy',
      transport_state: delivery.get(message.id) ?? 'stored' })) };
  }
}
