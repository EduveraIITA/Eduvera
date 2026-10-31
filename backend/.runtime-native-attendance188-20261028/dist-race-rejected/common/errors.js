var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { Catch, HttpException, HttpStatus, } from "@nestjs/common";
import { ZodError } from "zod";
import { SimulationCapacityException } from "../simulation/simulation-resource-policy.js";
let ApiExceptionFilter = class ApiExceptionFilter {
    catch(exception, host) {
        const context = host.switchToHttp();
        const request = context.getRequest();
        const reply = context.getResponse();
        let status = HttpStatus.INTERNAL_SERVER_ERROR;
        let code = "internal_error";
        let detail = "The request could not be completed.";
        let fields;
        let capacity;
        if (exception instanceof ZodError) {
            status = HttpStatus.BAD_REQUEST;
            code = "validation_error";
            detail = "Check the submitted fields and try again.";
            fields = exception.flatten().fieldErrors;
        }
        else if (exception instanceof HttpException) {
            status = exception.getStatus();
            code = status === HttpStatus.FORBIDDEN ? "permission_denied" : status === HttpStatus.NOT_FOUND ? "not_found" : "request_error";
            const response = exception.getResponse();
            if (typeof response === "string")
                detail = response;
            else if (response && typeof response === "object") {
                const payload = response;
                const message = payload.message;
                if (typeof message === "string")
                    detail = message;
                else if (Array.isArray(message))
                    detail = message.join(" ");
                if (payload.fields)
                    fields = payload.fields;
                if (typeof payload.code === "string")
                    code = payload.code;
                // Only the native, bounded Simulation admission exception may expose
                // these public recovery hints. Never forward arbitrary exception data.
                if (exception instanceof SimulationCapacityException
                    && ["worlds", "running_runs", "storage", "pinned_runs"].includes(String(payload.resource))
                    && typeof payload.limit === "number" && Number.isSafeInteger(payload.limit) && payload.limit > 0) {
                    capacity = { resource: String(payload.resource), limit: payload.limit };
                }
            }
        }
        else if (exception instanceof Error) {
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
};
ApiExceptionFilter = __decorate([
    Catch()
], ApiExceptionFilter);
export { ApiExceptionFilter };
export function badRequest(detail, fields) {
    return new HttpException({ message: detail, code: "validation_error", ...(fields ? { fields } : {}) }, 400);
}
//# sourceMappingURL=errors.js.map