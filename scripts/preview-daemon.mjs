import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runtime = resolve(root, ".runtime");
const pidPath = resolve(runtime, "preview-daemon.pid");
const action = process.argv[2] ?? "status";

if (!["start", "stop", "restart", "status"].includes(action)) {
  throw new Error("Usage: node scripts/preview-daemon.mjs start|stop|restart|status");
}

function storedPid() {
  if (!existsSync(pidPath)) return null;
  const pid = Number(readFileSync(pidPath, "utf8").trim());
  return Number.isInteger(pid) && pid > 1 ? pid : null;
}

function isRunning(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function stop() {
  const pid = storedPid();
  if (isRunning(pid)) {
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      process.kill(pid, "SIGTERM");
    }
  }
  if (existsSync(pidPath)) unlinkSync(pidPath);
}

function start() {
  const current = storedPid();
  if (isRunning(current)) {
    console.log(`Preview daemon already running with pid ${current}.`);
    return;
  }
  if (existsSync(pidPath)) unlinkSync(pidPath);
  mkdirSync(runtime, { recursive: true });
  const output = openSync(resolve(runtime, "preview-daemon.log"), "a", 0o600);
  const errors = openSync(resolve(runtime, "preview-daemon.error.log"), "a", 0o600);
  const child = spawn(process.execPath, [resolve(root, "scripts/preview-server.mjs")], {
    cwd: root,
    env: { ...process.env, LIVE_NGROK: "true" },
    detached: true,
    stdio: ["ignore", output, errors],
  });
  closeSync(output);
  closeSync(errors);
  if (!child.pid) throw new Error("Could not start the preview daemon.");
  writeFileSync(pidPath, `${child.pid}\n`, { mode: 0o600 });
  child.unref();
  console.log(`Preview daemon started with pid ${child.pid}.`);
}

if (action === "start") start();
if (action === "stop") {
  stop();
  console.log("Preview daemon stopped.");
}
if (action === "restart") {
  stop();
  start();
}
if (action === "status") {
  const pid = storedPid();
  console.log(isRunning(pid) ? `Preview daemon is running with pid ${pid}.` : "Preview daemon is not running.");
}
