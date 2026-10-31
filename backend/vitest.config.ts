import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { discoverTestFiles, partitionTestFiles } from "./test/test-projects.js";

export default defineConfig(({ mode }) => {
  const fast = mode === "fast";
  const inventory = partitionTestFiles(discoverTestFiles(fileURLToPath(new URL(".", import.meta.url))));
  return {
    test: {
      environment: "node",
      // Full/default retains per-file process isolation and serial DB mutations.
      // singleFork would share direct process.env mutations between DB files.
      pool: "forks",
      isolate: true,
      fileParallelism: fast,
      ...(fast ? {
        maxWorkers: 2,
        minWorkers: 1,
        env: {
          DATABASE_URL: "postgresql://127.0.0.1:1/thatcampus_fast_test",
          MIGRATION_DATABASE_URL: "postgresql://127.0.0.1:1/thatcampus_fast_test",
          EVENT_DATABASE_URL: "postgresql://127.0.0.1:1/thatcampus_fast_test",
          TEST_DATABASE_ISOLATED: "false",
          SIMULATION_DATABASE_TEST_ISOLATED: "false",
          AI_PROVIDER: "mock",
          AGENT_PROVIDER: "mock",
          TELEGRAM_BOT_ENABLED: "false",
          INVITATION_EMAIL_ENABLED: "false",
          RAZORPAY_ENABLED: "false",
        },
      } : {}),
      include: fast ? inventory.fast : ["test/**/*.test.ts"],
      testTimeout: 30_000,
      hookTimeout: 30_000,
      sequence: { concurrent: false },
    },
  };
});
