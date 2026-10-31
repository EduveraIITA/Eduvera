import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  type ExceptionFilter,
} from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { ZodError } from "zod";
import type { RequestWithContext } from "./request.js";
import { SimulationCapacityException } from "../simulation/simulation-resource-policy.js";
import { isDatabasePoolAcquisitionFailure } from "../database/pool-telemetry.js";

/** Reads may be retried explicitly. A write may have committed before a later
 * refresh failed, so never imply that its effects are absent or replay it. */
export function sendDatabaseUnavailable(request: Pick<RequestWithContext, "method" | "requestId">, reply: FastifyReply): FastifyReply {
  const read = ["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase());
  if (read) reply.header("Retry-After", "2");
  return reply.status(HttpStatus.SERVICE_UNAVAILABLE).send({ error: {
    status: HttpStatus.SERVICE_UNAVAILABLE,
    code: "service_unavailable",
    detail: read ? "Campus service is temporarily busy. Please try again shortly."
      : "Campus service is temporarily busy. This action could not be confirmed. Check its status before trying again.",
    request_id: request.requestId,
  } });
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<RequestWithContext>();
    const reply = context.getResponse<FastifyReply>();
    if (isDatabasePoolAcquisitionFailure(exception)) {
      request.log.error({ err: exception, requestId: request.requestId }, "Database connection unavailable");
      void sendDatabaseUnavailable(request, reply);
      return;
    }
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = "internal_error";
    let detail = "The request could not be completed.";
    let fields: unknown;
    let capacity: { resource: string; limit: number } | undefined;

    if (exception instanceof ZodError) {
      status = HttpStatus.BAD_REQUEST;
      code = "validation_error";
      detail = "Check the submitted fields and try again.";
      fields = exception.flatten().fieldErrors;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = status === HttpStatus.FORBIDDEN ? "permission_denied" : status === HttpStatus.NOT_FOUND ? "not_found" : "request_error";
      const response = exception.getResponse();
      if (typeof response === "string") detail = response;
      else if (response && typeof response === "object") {
        const payload = response as Record<string, unknown>;
        const message = payload.message;
        if (typeof message === "string") detail = message;
        else if (Array.isArray(message)) detail = message.join(" ");
        if (payload.fields) fields = payload.fields;
        if (typeof payload.code === "string") code = payload.code;
        // Only the native, bounded Simulation admission exception may expose
        // these public recovery hints. Never forward arbitrary exception data.
        if (exception instanceof SimulationCapacityException
          && ["worlds", "running_runs", "storage", "pinned_runs"].includes(String(payload.resource))
          && typeof payload.limit === "number" && Number.isSafeInteger(payload.limit) && payload.limit > 0) {
          capacity = { resource: String(payload.resource), limit: payload.limit };
        }
      }
    } else if (exception instanceof Error) {
      request.log.error({ err: exception, requestId: request.requestId }, "Unhandled request error");
    }

    void reply.status(status).send({
      error: {
        status,
        code,
        detail,
        ...(fields ? { fields } : {}),
        ...capacity,
        request_id: request.requestId,
      },
    });
  }
}

export function badRequest(detail: string, fields?: Record<string, string | string[]>): HttpException {
  return new HttpException({ message: detail, code: "validation_error", ...(fields ? { fields } : {}) }, 400);
}
