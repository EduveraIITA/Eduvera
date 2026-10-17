import { loadBehaviorFixture } from "./model.mjs";
import { CampusSimulatorRuntime } from "./runtime.mjs";
import { assertSafeEnvironment } from "./safety.mjs";
import { startStatusServer } from "./status-server.mjs";

async function main() {
  const configuration = assertSafeEnvironment(process.env);
  const behavior = await loadBehaviorFixture();
  const runtime = new CampusSimulatorRuntime({
    apiOrigin: configuration.apiOrigin,
    behavior,
    demoPassword: configuration.demoPassword,
    startedAt: new Date(),
  });
  const server = await startStatusServer({
    port: configuration.port,
    proxyKey: configuration.proxyKey,
    getStatus: () => runtime.snapshot(),
  });
  console.log(`[campus-lab] read-only status listening on 127.0.0.1:${configuration.port}`);
  void runtime.bootWithRetry();

  const shutdown = () => {
    runtime.stop();
    server.close(() => process.exit(0));
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error(`[campus-lab] ${error instanceof Error ? error.message : "startup failed"}`);
  process.exitCode = 1;
});
