import "reflect-metadata";
import compress from "@fastify/compress";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { access } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { AppModule } from "./app.module.js";
import { ApiExceptionFilter } from "./common/errors.js";
import { rateLimitHook } from "./common/rate-limit.js";
import { config } from "./config.js";
import { DatabaseService } from "./database/database.service.js";

async function bootstrap(): Promise<void> {
  const settings = config();
  const adapter = new FastifyAdapter({
    trustProxy: settings.TRUST_PROXY,
    routerOptions: { ignoreTrailingSlash: true },
    bodyLimit: 12 * 1024 * 1024,
    logger: { level: settings.LOG_LEVEL, redact: ["req.headers.authorization", "req.headers.cookie", "res.headers.set-cookie"] },
  });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, { bufferLogs: true });
  const server = app.getHttpAdapter().getInstance();
  await app.register(cookie, { secret: settings.COOKIE_SECRET, hook: "onRequest" });
  await app.register(helmet, settings.NODE_ENV === "production" ? {} : { contentSecurityPolicy: false });
  await app.register(compress);
  await app.register(multipart, { limits: { files: 1, fileSize: 24 * 1024 * 1024, fields: 20, parts: 21 } });
  try {
    await access(join(settings.spaDistDir, "index.html"));
    await app.register(fastifyStatic, {
      root: join(settings.spaDistDir, "assets"),
      prefix: "/assets/",
      wildcard: true,
    });
  } catch {
    // The API remains runnable before the separately-built React bundle exists.
  }
  try {
    await access(join(settings.staffDistDir, "index.html"));
    await app.register(fastifyStatic, {
      root: join(settings.staffDistDir, "assets"),
      prefix: "/staff/assets/",
      wildcard: true,
      decorateReply: false,
    });
  } catch {
    // The desktop staff console is optional; the API and mobile app run without it.
  }
  app.enableCors({
    credentials: true,
    origin(origin, callback) {
      if (!origin || settings.allowedOrigins.includes(origin)) callback(null, true);
      else callback(new Error("Origin is not allowed"), false);
    },
  });
  server.addHook("onRequest", async (request, reply) => {
    const requestIdHeader = request.headers["x-request-id"];
    const requestId = typeof requestIdHeader === "string" && /^[0-9a-f-]{36}$/i.test(requestIdHeader) ? requestIdHeader : randomUUID();
    (request as any).requestId = requestId;
    reply.header("X-Request-ID", requestId);
  });
  server.addHook("onRequest", rateLimitHook(app.get(DatabaseService)));
  app.useGlobalFilters(new ApiExceptionFilter());

  const swagger = new DocumentBuilder().setTitle("OmniSchool API").setDescription("Versioned APIs powering the OmniSchool parent and student experiences.").setVersion("1.0.0").addCookieAuth(settings.SESSION_COOKIE_NAME).build();
  const document = SwaggerModule.createDocument(app, swagger);
  SwaggerModule.setup("api/docs", app, document, { jsonDocumentUrl: "/api/schema" });

  await app.init();
  app.enableShutdownHooks();
  await app.listen({ host: settings.HOST, port: settings.PORT });
  Logger.log(`OmniSchool API listening on http://${settings.HOST}:${settings.PORT}`);
}

void bootstrap();
