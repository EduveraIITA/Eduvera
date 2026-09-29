/* eslint-disable */
// @ts-nocheck
import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req, Res } from "@nestjs/common";
import { ApiCookieAuth, ApiTags } from "@nestjs/swagger";
import type { FastifyReply } from "fastify";
import type { AuthenticatedRequest } from "../common/request.js";
import { ChatService, type ChatUpload } from "./chat.service.js";

async function messageBody(request: AuthenticatedRequest): Promise<{ body: Record<string, unknown>; upload?: ChatUpload }> {
  if (!request.isMultipart()) return { body: (request.body ?? {}) as Record<string, unknown> };
  const body: Record<string, unknown> = {};
  let upload: ChatUpload | undefined;
  for await (const part of request.parts()) {
    if (part.type === "file") {
      if (part.fieldname !== "file") {
        await part.toBuffer();
        continue;
      }
      if (upload) throw new (await import("@nestjs/common")).BadRequestException("Only one attachment can be sent per message.");
      upload = { filename: part.filename, mimetype: part.mimetype, data: await part.toBuffer() };
    } else {
      body[part.fieldname] = part.value;
    }
  }
  return { body, ...(upload ? { upload } : {}) };
}

@ApiTags("chat")
@ApiCookieAuth()
@Controller("api/v1/chat")
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Get("reports/")
  reports(@Req() request: AuthenticatedRequest, @Query("status") status?: string) {
    return this.chat.reports(request.authUser, status);
  }

  @Get("reports/reviewers/")
  reportReviewers(@Req() request: AuthenticatedRequest) {
    return this.chat.reportReviewers(request.authUser);
  }

  @Patch("reports/:reportId/")
  @HttpCode(200)
  updateReport(
    @Req() request: AuthenticatedRequest,
    @Param("reportId") reportId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.chat.updateReport(request.authUser, reportId, body, request);
  }

  @Get("conversations/")
  conversations(@Req() request: AuthenticatedRequest) {
    return this.chat.conversations(request.authUser);
  }

  @Get("recipients/")
  recipients(@Req() request: AuthenticatedRequest, @Query("student_id") studentId?: string) {
    return this.chat.recipients(request.authUser, studentId);
  }

  @Post("groups/")
  createGroup(@Req() request: AuthenticatedRequest) {
    return this.chat.createGroup(request.authUser, request.body, request);
  }

  @Get("policy/")
  policy(@Req() request: AuthenticatedRequest) {
    return this.chat.policyForUser(request.authUser);
  }

  @Patch("policy/")
  updatePolicy(@Req() request: AuthenticatedRequest, @Body() body: Record<string, unknown>) {
    return this.chat.updatePolicy(request.authUser, body, request);
  }

  @Post("conversations/")
  createConversation(@Req() request: AuthenticatedRequest) {
    return this.chat.createConversation(request.authUser, request.body, request);
  }

  @Get("conversations/:conversationId/messages/")
  messages(
    @Req() request: AuthenticatedRequest,
    @Param("conversationId") conversationId: string,
    @Query("before") before?: string,
  ) {
    return this.chat.messages(request.authUser, conversationId, before);
  }

  @Post("conversations/:conversationId/messages/")
  async send(
    @Req() request: AuthenticatedRequest,
    @Param("conversationId") conversationId: string,
  ) {
    const parsed = await messageBody(request);
    return this.chat.send(request.authUser, conversationId, parsed.body, parsed.upload, request);
  }

  @Post("conversations/:conversationId/read/")
  @HttpCode(200)
  read(@Req() request: AuthenticatedRequest, @Param("conversationId") conversationId: string) {
    return this.chat.markRead(request.authUser, conversationId);
  }

  @Patch("conversations/:conversationId/messages/:messageId/")
  @HttpCode(200)
  edit(@Req() request: AuthenticatedRequest, @Param("conversationId") conversationId: string, @Param("messageId") messageId: string) {
    return this.chat.editMessage(request.authUser, conversationId, messageId, request.body);
  }

  @Post("conversations/:conversationId/messages/:messageId/report/")
  @HttpCode(200)
  report(
    @Req() request: AuthenticatedRequest,
    @Param("conversationId") conversationId: string,
    @Param("messageId") messageId: string,
  ) {
    return this.chat.reportMessage(request.authUser, conversationId, messageId, request.body, request);
  }

  @Get("conversations/:conversationId/messages/:messageId/attachment/")
  async attachment(
    @Req() request: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Param("conversationId") conversationId: string,
    @Param("messageId") messageId: string,
  ) {
    const result = await this.chat.attachment(request.authUser, conversationId, messageId);
    const filename = result.attachment.original_name.replace(/[\r\n"]/g, "_");
    reply.type(result.attachment.content_type || "application/octet-stream");
    reply.header("Content-Disposition", `inline; filename="${filename}"`);
    return reply.send(result.stream);
  }
}
