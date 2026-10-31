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
import { Controller, Get, Headers, Res, UnauthorizedException, ServiceUnavailableException } from "@nestjs/common";
import { timingSafeEqual } from "node:crypto";
import { Public } from "./common/decorators.js";
import { config } from "./config.js";
import { DatabaseService } from "./database/database.service.js";
import { SchoolEventService } from "./school/school-event.service.js";
let AppController = class AppController {
    db;
    events;
    constructor(db, events) {
        this.db = db;
        this.events = events;
    }
    health() {
        return { status: "ok", service: "omnischool-api" };
    }
    async ready() {
        await this.db.ping();
        if (!this.events.isReady())
            throw new ServiceUnavailableException("The event delivery connection is not ready.");
        return { status: "ready", database: "ok", events: "ok" };
    }
    async metrics(authorization, reply) {
        const expected = config().METRICS_TOKEN;
        if (expected) {
            const supplied = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
            const expectedBytes = Buffer.from(expected);
            const suppliedBytes = Buffer.from(supplied);
            if (expectedBytes.length !== suppliedBytes.length || !timingSafeEqual(expectedBytes, suppliedBytes)) {
                throw new UnauthorizedException("A valid monitoring token is required.");
            }
        }
        // Set the Prometheus content type only after authorization succeeds. Setting
        // it with @Header forced JSON error bodies through Fastify's text serializer,
        // turning an intended 401 into a 500 response.
        reply.header("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
        return (await this.events.prometheusMetrics()) + this.db.prometheusMetrics();
    }
};
__decorate([
    Public(),
    Get("healthz"),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], AppController.prototype, "health", null);
__decorate([
    Public(),
    Get("readyz"),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], AppController.prototype, "ready", null);
__decorate([
    Public(),
    Get("metrics"),
    __param(0, Headers("authorization")),
    __param(1, Res({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AppController.prototype, "metrics", null);
AppController = __decorate([
    Controller(),
    __metadata("design:paramtypes", [DatabaseService, SchoolEventService])
], AppController);
export { AppController };
//# sourceMappingURL=app.controller.js.map