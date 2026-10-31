import { spawn } from "node:child_process";
import { isAbsolute } from "node:path";
import { postgresLibpqConnectionEnvironment } from "./connection-policy.js";

/** Capture uses only its explicit Live source; inherited libpq/service settings
 * must not redirect the child into a different database or selected world. */
export async function simulationSchemaDump(url: string, snapshotId: string, executable: string): Promise<string> {
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("PG")));
  const child = spawn(executable, ["--schema-only", "--schema=public", "--no-owner", "--no-privileges", "--no-comments", `--snapshot=${snapshotId}`], {
    env: { ...inherited, ...postgresLibpqConnectionEnvironment(url, {
      name: "DATABASE_URL", purpose: "application", requireRemoteTls: true,
    }) },
    timeout: 60_000, stdio: ["ignore", "pipe", "pipe"],
  });
  return new Promise((resolve, reject) => {
    let output = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { output += chunk; });
    child.stderr.resume(); // Never return connection diagnostics or credentials.
    child.once("error", () => reject(new SimulationCaptureDependencyError()));
    child.once("exit", code => code === 0 ? resolve(output) : reject(new Error("The Simulation schema snapshot could not be captured.")));
  });
}

/** Safe presentation only: never propagate executable paths or process diagnostics. */
export class SimulationCaptureDependencyError extends Error {
  constructor(reason: "unavailable" | "version" | "source" = "unavailable") {
    super(reason === "version"
      ? "Simulation cannot start because the server's snapshot tool needs updating. Ask the administrator to check the PostgreSQL client configuration, then try again."
      : reason === "source"
        ? "Simulation cannot start because the campus snapshot connection is unavailable. Try again shortly."
        : "Simulation cannot start because the server's snapshot tool is unavailable. Ask the administrator to check the PostgreSQL client configuration, then try again.");
    this.name = "SimulationCaptureDependencyError";
  }
}

/** An explicit deployment override must be one absolute executable, never a shell command. */
export function simulationPgDumpExecutable(configured?: string): string {
  if (configured === undefined) return "pg_dump";
  if (!isAbsolute(configured) || configured.trim() !== configured || /[\r\n\0]/u.test(configured)) {
    throw new SimulationCaptureDependencyError();
  }
  return configured;
}

export function assertSimulationPgDumpVersion(output: string, serverVersion: number): number {
  const match = /^pg_dump \(PostgreSQL\) (\d+)\.(\d+)(?:\D|$)/u.exec(output.trim());
  const major = match ? Number(match[1]) : NaN;
  const serverMajor = Math.floor(serverVersion / 10_000);
  if (!Number.isSafeInteger(serverVersion) || serverVersion < 170_000
    || !Number.isSafeInteger(major) || major < Math.max(17, serverMajor)) {
    throw new SimulationCaptureDependencyError("version");
  }
  return major;
}

/** Read-only, bounded preflight; no connection values or arbitrary stderr are returned. */
export async function simulationPgDumpVersion(
  executable: string,
  options: { env?: NodeJS.ProcessEnv; timeoutMs?: number } = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ["--version"], {
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: options.timeoutMs ?? 5_000,
      killSignal: "SIGKILL",
    });
    let output = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      output += chunk;
      if (output.length > 4_096) child.kill("SIGKILL");
    });
    child.stderr.resume();
    child.once("error", () => reject(new SimulationCaptureDependencyError()));
    child.once("close", (code) => code === 0 && output.length <= 4_096
      ? resolve(output)
      : reject(new SimulationCaptureDependencyError()));
  });
}
