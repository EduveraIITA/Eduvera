import "reflect-metadata";
import compress from "@fastify/compress";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import { PRIVATE_IMAGE_SOURCES } from "./common/attachment-headers.js";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { randomUUID } from "node:crypto";
import { AppModule } from "./app.module.js";
import { ApiExceptionFilter } from "./common/errors.js";
import { registerApiResponseCacheControl } from "./common/api-response-cache.js";
import { rateLimitHook } from "./common/rate-limit.js";
import { config } from "./config.js";
import { DatabaseService } from "./database/database.service.js";
import { registerWebAssets, WEB_ASSET_SCRIPT_SOURCES } from "./web-assets.js";

async function bootstrap(): Promise<void> {
  const settings = config();
  const adapter = new FastifyAdapter({
    trustProxy: settings.TRUST_PROXY,
    routerOptions: { ignoreTrailingSlash: true },
    bodyLimit: 12 * 1024 * 1024,
    logger: { level: settings.LOG_LEVEL, redact: ["req.headers.authorization", "req.headers.cookie", "res.headers.set-cookie"] },
  });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, { bufferLogs: true, rawBody: true });
  const server = app.getHttpAdapter().getInstance();
  registerApiResponseCacheControl(server);
  await app.register(cookie, { secret: settings.COOKIE_SECRET, hook: "onRequest" });
  const googleSources = settings.GOOGLE_CLIENT_ID ? ["https://accounts.google.com"] : [];
  const razorpay = settings.RAZORPAY_ENABLED;
  await app.register(helmet, {
    crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
    contentSecurityPolicy: settings.NODE_ENV === "production" ? { directives: {
      imgSrc: PRIVATE_IMAGE_SOURCES,
      formAction: ["'self'", ...(razorpay ? ["https://api.razorpay.com"] : [])],
      scriptSrc: [...WEB_ASSET_SCRIPT_SOURCES, ...googleSources, ...(razorpay ? ["https://checkout.razorpay.com", "https://cdn.razorpay.com", "https://checkout-static-next.razorpay.com"] : [])],
      styleSrc: ["'self'", "'unsafe-inline'", "https:", ...googleSources],
      frameSrc: ["'self'", ...googleSources, ...(razorpay ? ["https://api.razorpay.com", "https://checkout.razorpay.com"] : [])],
      connectSrc: ["'self'", ...googleSources, ...(razorpay ? ["https://api.razorpay.com", "https://api-dark.razorpay.com", "https://checkout.razorpay.com", "https://express.razorpay.com", "https://lumberjack.razorpay.com", "https://lumberjack-cx.razorpay.com", "https://lumberjack-metrics.razorpay.com"] : [])],
    } } : false,
  });
  await app.register(compress);
  await app.register(multipart, { limits: { files: 1, fileSize: 24 * 1024 * 1024, fields: 20, parts: 21 } });
  await registerWebAssets(server, settings.spaDistDir);
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

  const swagger = new DocumentBuilder().setTitle("ThatCampus API").setDescription("Versioned APIs powering ThatCampus web and native experiences.").setVersion("1.0.0").addCookieAuth(settings.SESSION_COOKIE_NAME).addBearerAuth({ type: "http", scheme: "bearer", description: "Opaque native session issued by /api/v1/auth/native/login/." }, "native-session").build();
  const document = SwaggerModule.createDocument(app, swagger);
  SwaggerModule.setup("api/docs", app, document, { jsonDocumentUrl: "/api/schema" });

  await app.init();
  app.enableShutdownHooks();
  await app.listen({ host: settings.HOST, port: settings.PORT });
  Logger.log(`ThatCampus API listening on http://${settings.HOST}:${settings.PORT}`);
}

void bootstrap();
