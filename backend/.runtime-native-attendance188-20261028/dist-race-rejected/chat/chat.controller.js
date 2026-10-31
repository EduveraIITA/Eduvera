var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
import { RequirePermission } from "../roles/permissions.js";
// @ts-nocheck
import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req, Res } from "@nestjs/common";
import { ApiCookieAuth, ApiTags } from "@nestjs/swagger";
import { ChatService } from "./chat.service.js";
async function messageBody(request) {
    if (!request.isMultipart())
        return { body: (request.body ?? {}) };
    const body = {};
    let upload;
    for await (const part of request.parts()) {
        if (part.type === "file") {
            if (part.fieldname !== "file") {
                await part.toBuffer();
                continue;
            }
            if (upload)
                throw new (await import("@nestjs/common")).BadRequestException("Only one attachment can be sent per message.");
            upload = { filename: part.filename, mimetype: part.mimetype, data: await part.toBuffer() };
        }
        else {
            body[part.fieldname] = part.value;
        }
    }
    return { body, ...(upload ? { upload } : {}) };
}
let ChatController = class ChatController {
    chat;
    constructor(chat) {
        this.chat = chat;
    }
    reports(request, status) {
        return this.chat.reports(request.authUser, status);
    }
    reportReviewers(request) {
        return this.chat.reportReviewers(request.authUser);
    }
    reportDetail(request, reportId) {
        return this.chat.report(request.authUser, reportId);
    }
    updateReport(request, reportId, body) {
        return this.chat.updateReport(request.authUser, reportId, body, request);
    }
    conversations(request, pagination, q, cursor, studentId) {
        return this.chat.conversations(request.authUser, { pagination, q, cursor, student_id: studentId });
    }
    conversation(request, conversationId, studentId) {
        return this.chat.conversation(request.authUser, conversationId, studentId);
    }
    recipients(request, studentId, purpose) {
        return this.chat.recipients(request.authUser, studentId, purpose ?? "direct");
    }
    createGroup(request) {
        return this.chat.createGroup(request.authUser, request.body, request);
    }
    policy(request) {
        return this.chat.policyForUser(request.authUser);
    }
    createConversation(request) {
        return this.chat.createConversation(request.authUser, request.body, request);
    }
    messages(request, conversationId, before, cursor, throughCursor) {
        return this.chat.messages(request.authUser, conversationId, before, cursor, throughCursor);
    }
    async send(request, conversationId) {
        const parsed = await messageBody(request);
        return this.chat.send(request.authUser, conversationId, parsed.body, parsed.upload, request);
    }
    read(request, conversationId) {
        return this.chat.markRead(request.authUser, conversationId, request);
    }
    edit(request, conversationId, messageId) {
        return this.chat.editMessage(request.authUser, conversationId, messageId, request.body, request);
    }
    report(request, conversationId, messageId) {
        return this.chat.reportMessage(request.authUser, conversationId, messageId, request.body, request);
    }
    async attachment(request, reply, conversationId, messageId) {
        const result = await this.chat.attachment(request.authUser, conversationId, messageId);
        const filename = result.attachment.original_name.replace(/[\r\n"]/g, "_");
        reply.type(result.attachment.content_type || "application/octet-stream");
        reply.header("Content-Disposition", `inline; filename="${filename}"`);
        reply.header("X-ThatCampus-Evidence-Mode", result.evidence_mode);
        reply.header("X-ThatCampus-Source-Content-Omitted", String(result.source_content_omitted));
        return reply.send(result.stream);
    }
};
__decorate([
    Get("reports/"),
    RequirePermission("safeguarding.review"),
    __param(0, Req()),
    __param(1, Query("status")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], ChatController.prototype, "reports", null);
__decorate([
    Get("reports/reviewers/"),
    RequirePermission("safeguarding.review"),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], ChatController.prototype, "reportReviewers", null);
__decorate([
    Get("reports/:reportId/"),
    RequirePermission("safeguarding.review"),
    __param(0, Req()),
    __param(1, Param("reportId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], ChatController.prototype, "reportDetail", null);
__decorate([
    Patch("reports/:reportId/"),
    HttpCode(200),
    RequirePermission("safeguarding.review"),
    __param(0, Req()),
    __param(1, Param("reportId")),
    __param(2, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], ChatController.prototype, "updateReport", null);
__decorate([
    Get("conversations/"),
    RequirePermission("messages.view"),
    __param(0, Req()),
    __param(1, Query("pagination")),
    __param(2, Query("q")),
    __param(3, Query("cursor")),
    __param(4, Query("student_id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String, String]),
    __metadata("design:returntype", void 0)
], ChatController.prototype, "conversations", null);
__decorate([
    Get("conversations/:conversationId/"),
    RequirePermission("messages.view"),
    __param(0, Req()),
    __param(1, Param("conversationId")),
    __param(2, Query("student_id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], ChatController.prototype, "conversation", null);
__decorate([
    Get("recipients/"),
    RequirePermission("messages.view"),
    __param(0, Req()),
    __param(1, Query("student_id")),
    __param(2, Query("purpose")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], ChatController.prototype, "recipients", null);
__decorate([
    Post("groups/"),
    RequirePermission("groups.create"),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], ChatController.prototype, "createGroup", null);
__decorate([
    Get("policy/"),
    RequirePermission("messages.view"),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], ChatController.prototype, "policy", null);
__decorate([
    Post("conversations/"),
    RequirePermission("messages.send"),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], ChatController.prototype, "createConversation", null);
__decorate([
    Get("conversations/:conversationId/messages/"),
    RequirePermission("messages.view"),
    __param(0, Req()),
    __param(1, Param("conversationId")),
    __param(2, Query("before")),
    __param(3, Query("cursor")),
    __param(4, Query("through_cursor")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String, String]),
    __metadata("design:returntype", void 0)
], ChatController.prototype, "messages", null);
__decorate([
    Post("conversations/:conversationId/messages/"),
    RequirePermission("messages.send"),
    __param(0, Req()),
    __param(1, Param("conversationId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], ChatController.prototype, "send", null);
__decorate([
    Post("conversations/:conversationId/read/"),
    HttpCode(200),
    RequirePermission("messages.view"),
    __param(0, Req()),
    __param(1, Param("conversationId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], ChatController.prototype, "read", null);
__decorate([
    Patch("conversations/:conversationId/messages/:messageId/"),
    HttpCode(200),
    RequirePermission("messages.send"),
    __param(0, Req()),
    __param(1, Param("conversationId")),
    __param(2, Param("messageId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], ChatController.prototype, "edit", null);
__decorate([
    Post("conversations/:conversationId/messages/:messageId/report/"),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param("conversationId")),
    __param(2, Param("messageId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], ChatController.prototype, "report", null);
__decorate([
    Get("conversations/:conversationId/messages/:messageId/attachment/"),
    RequirePermission("messages.view"),
    __param(0, Req()),
    __param(1, Res()),
    __param(2, Param("conversationId")),
    __param(3, Param("messageId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, String, String]),
    __metadata("design:returntype", Promise)
], ChatController.prototype, "attachment", null);
ChatController = __decorate([
    ApiTags("chat"),
    ApiCookieAuth(),
    Controller("api/v1/chat"),
    __metadata("design:paramtypes", [ChatService])
], ChatController);
export { ChatController };
//# sourceMappingURL=chat.controller.js.map