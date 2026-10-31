import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

function preventApiResponseStorage(request: FastifyRequest, reply: FastifyReply): void {
  const path = request.url.split("?", 1)[0]!;
  if (path === "/api" || path.startsWith("/api/")) {
    // API representations, including failures, depend on the authenticated
    // session's authority and selected Live/Simulation environment. A cached
    // 410 must not survive Return to Live, logout or another person's login.
    reply.header("Cache-Control", "private, no-store");
  }
}

/** Register before plugins so even early authentication/rate-limit failures inherit it. */
export function registerApiResponseCacheControl(server: Pick<FastifyInstance, "addHook">): void {
  server.addHook("onRequest", async (request, reply) => {
    preventApiResponseStorage(request, reply);
  });
  server.addHook("onSend", async (request, reply, payload) => {
    // Reassert after controllers and error handlers that set their own headers.
    preventApiResponseStorage(request, reply);
    return payload;
  });
}
