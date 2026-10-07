import { Controller, Get, Headers, Res, UnauthorizedException, ServiceUnavailableException } from "@nestjs/common";
import { timingSafeEqual } from "node:crypto";
import type { FastifyReply } from "fastify";
import { Public } from "./common/decorators.js";
import { config } from "./config.js";
import { DatabaseService } from "./database/database.service.js";
import { SchoolEventService } from "./school/school-event.service.js";

@Controller()
export class AppController {
  constructor(private readonly db: DatabaseService, private readonly events: SchoolEventService) {}

  @Public()
  @Get("healthz")
  health() {
    return { status: "ok", service: "omnischool-api" };
  }

  @Public()
  @Get("readyz")
  async ready() {
    await this.db.ping();
    if (!this.events.isReady()) throw new ServiceUnavailableException("The event delivery connection is not ready.");
    return { status: "ready", database: "ok", events: "ok" };
  }

  @Public()
  @Get("metrics")
  metrics(
    @Headers("authorization") authorization: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
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
    return this.events.prometheusMetrics();
  }
}
