import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, watch, writeFileSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { homedir, tmpdir } from "node:os";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const backendRoot = resolve(root, "backend");
const frontendRoot = resolve(root, "frontend");
const photoAttendanceRoot = resolve(root, "services/photo-attendance");
const runtimeRoot = resolve(root, ".runtime");
const scratchRoot = resolve(tmpdir(), "eduvera-preview-runtime");
const backendRunRoot = process.env.PREVIEW_BACKEND_ROOT || resolve(scratchRoot, "backend");
const frontendRunRoot = process.env.PREVIEW_FRONTEND_ROOT || frontendRoot;
const photoAttendanceRunRoot = process.env.PREVIEW_PHOTO_ROOT || resolve(scratchRoot, "photo-attendance");
const photoDataRoot = process.env.PREVIEW_PHOTO_DATA_ROOT || resolve(runtimeRoot, "photo-attendance");
loadEnvFile(resolve(backendRoot, ".env"));
// This entry point is only for the local review environment.
const database = new URL(process.env.DATABASE_URL);
if (!["127.0.0.1", "localhost", "[::1]"].includes(database.hostname)) {
  throw new Error("Local preview requires a loopback PostgreSQL database.");
}

const apiOrigin = "http://127.0.0.1:8001";
const appOrigin = "http://127.0.0.1:8000";
const appLocalhostOrigin = "http://localhost:8000";
const commonPath = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";
const childPath = [process.env.PATH, commonPath].filter(Boolean).join(":");
const origins = new Set((process.env.ALLOWED_ORIGINS ?? "").split(",").map((origin) => origin.trim()).filter(Boolean));
origins.add("http://127.0.0.1:8000");
origins.add("http://localhost:8000");

mkdirSync(runtimeRoot, { recursive: true });
mkdirSync(scratchRoot, { recursive: true });

function replaceDirectory(source, destination) {
  rmSync(destination, { recursive: true, force: true });
  cpSync(source, destination, { recursive: true });
}

function copyFile(source, destination) {
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(source, destination);
}

function fileHash(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function runSetup(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, env: { ...process.env, PATH: childPath }, stdio: "inherit" });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed while preparing the local preview runtime.`);
}

if (!process.env.PREVIEW_BACKEND_ROOT) {
  mkdirSync(backendRunRoot, { recursive: true });
  replaceDirectory(resolve(backendRoot, "src"), resolve(backendRunRoot, "src"));
  for (const file of ["package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json"]) {
    copyFile(resolve(backendRoot, file), resolve(backendRunRoot, file));
  }
  const dependencyKey = fileHash(resolve(backendRoot, "package-lock.json"));
  const dependencyMarker = resolve(backendRunRoot, ".dependencies-ready");
  if (!existsSync(dependencyMarker) || readFileSync(dependencyMarker, "utf8").trim() !== dependencyKey) {
    rmSync(resolve(backendRunRoot, "node_modules"), { recursive: true, force: true });
    runSetup("npm", ["ci", "--no-audit", "--no-fund"], backendRunRoot);
    writeFileSync(dependencyMarker, `${dependencyKey}\n`, { mode: 0o600 });
  }
  // Nest relies on TypeScript's emitted decorator metadata for constructor
  // injection. `tsx` transpiles quickly but does not emit that metadata, which
  // can leave controller dependencies undefined. Build once before starting,
  // then keep tsc and Node's native watcher running for live backend edits.
  runSetup("npm", ["run", "build", "--silent"], backendRunRoot);
}

if (!process.env.PREVIEW_PHOTO_ROOT) {
  mkdirSync(photoAttendanceRunRoot, { recursive: true });
  replaceDirectory(resolve(photoAttendanceRoot, "app"), resolve(photoAttendanceRunRoot, "app"));
  replaceDirectory(resolve(photoAttendanceRoot, "models"), resolve(photoAttendanceRunRoot, "models"));
  copyFile(resolve(photoAttendanceRoot, "requirements.txt"), resolve(photoAttendanceRunRoot, "requirements.txt"));
  const dependencyKey = fileHash(resolve(photoAttendanceRoot, "requirements.txt"));
  const dependencyMarker = resolve(photoAttendanceRunRoot, ".dependencies-ready");
  const localPython = resolve(photoAttendanceRunRoot, ".venv/bin/python");
  if (!existsSync(localPython) || !existsSync(dependencyMarker) || readFileSync(dependencyMarker, "utf8").trim() !== dependencyKey) {
    rmSync(resolve(photoAttendanceRunRoot, ".venv"), { recursive: true, force: true });
    const bootstrapPython = ["/opt/homebrew/bin/python3", "/usr/local/bin/python3", "/usr/bin/python3"].find((path) => existsSync(path));
    if (!bootstrapPython) throw new Error("Python 3 is required to prepare photo attendance.");
    runSetup(bootstrapPython, ["-m", "venv", resolve(photoAttendanceRunRoot, ".venv")], photoAttendanceRunRoot);
    runSetup(localPython, ["-m", "pip", "install", "--disable-pip-version-check", "-r", resolve(photoAttendanceRunRoot, "requirements.txt")], photoAttendanceRunRoot);
    writeFileSync(dependencyMarker, `${dependencyKey}\n`, { mode: 0o600 });
  }
}

const photoTokenPath = resolve(runtimeRoot, "photo-attendance-token");
if (!existsSync(photoTokenPath)) {
  writeFileSync(photoTokenPath, randomBytes(32).toString("base64url"), { mode: 0o600 });
}
const photoToken = readFileSync(photoTokenPath, "utf8").trim();
const photoPythonCandidates = [
  process.env.PHOTO_ATTENDANCE_PYTHON,
  resolve(photoAttendanceRunRoot, ".venv/bin/python"),
  resolve(photoAttendanceRoot, ".venv/bin/python"),
  resolve(root, "../../Downloads/attendance-lab/.venv/bin/python"),
].filter(Boolean);
const photoPython = photoPythonCandidates.find((candidate) => existsSync(candidate));
if (!photoPython) {
  throw new Error("Photo attendance Python environment is missing. Create services/photo-attendance/.venv and install its requirements.");
}
const photoModelCandidates = [
  process.env.PHOTO_ATTENDANCE_MODELS_DIR,
  resolve(photoAttendanceRunRoot, "models"),
  resolve(root, "../../Downloads/attendance-lab/models"),
].filter(Boolean);
const photoModels = photoModelCandidates.find((candidate) =>
  existsSync(resolve(candidate, "yunet.onnx")) && existsSync(resolve(candidate, "sface.onnx")),
);
if (!photoModels) {
  throw new Error("Photo attendance models are missing. Run services/photo-attendance/scripts/download_models.py.");
}

const backendEnv = {
  ...process.env,
  PATH: childPath,
  NODE_ENV: "development",
  DEPLOYMENT_ENVIRONMENT: "development",
  HOST: "127.0.0.1",
  PORT: "8001",
  COOKIE_SECURE: "false",
  RATE_LIMIT_STORE: "memory",
  EVENT_DATABASE_URL: process.env.EVENT_DATABASE_URL || process.env.DATABASE_URL,
  SPA_DIST_DIR: resolve(root, "frontend/dist"),
  STAFF_DIST_DIR: resolve(root, "frontend-desktop/dist"),
  ALLOWED_ORIGINS: [...origins].join(","),
  PHOTO_ATTENDANCE_ENABLED: "true",
  PHOTO_ATTENDANCE_BASE_URL: "http://127.0.0.1:8100/api",
  PHOTO_ATTENDANCE_API_TOKEN: photoToken,
  PHOTO_ATTENDANCE_TIMEOUT_MS: "300000",
};

const photoAttendanceEnv = {
  ...process.env,
  PATH: childPath,
  DATA_DIR: photoDataRoot,
  MODELS_DIR: photoModels,
  ATTENDANCE_API_TOKEN: photoToken,
  ALLOWED_HOSTS: "localhost,127.0.0.1,[::1]",
  SESSION_RETENTION_DAYS: "7",
  OLLAMA_MODEL: process.env.PHOTO_ATTENDANCE_OLLAMA_MODEL || "qwen3-vl:4b-instruct",
  OLLAMA_URL: process.env.PHOTO_ATTENDANCE_OLLAMA_URL || process.env.OLLAMA_URL || process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434",
};

const frontendEnv = {
  ...process.env,
  PATH: childPath,
  BROWSER: "none",
  VITE_API_PROXY_TARGET: apiOrigin,
  VITE_DEV_PORT: "8000",
  VITE_DEV_HOST: "127.0.0.1",
  VITE_ALLOWED_HOSTS: "dalene-miraculous-sweepingly.ngrok-free.dev",
};

const children = new Map();
const sourceWatchers = [];
let shuttingDown = false;

function mirrorSourceChanges(source, destination) {
  const destinationRoot = `${resolve(destination)}${sep}`;
  const watcher = watch(source, { recursive: true }, (_event, filename) => {
    if (!filename) return;
    const sourcePath = resolve(source, filename);
    const destinationPath = resolve(destination, filename);
    if (!destinationPath.startsWith(destinationRoot)) return;
    try {
      if (!existsSync(sourcePath)) {
        rmSync(destinationPath, { recursive: true, force: true });
      } else if (statSync(sourcePath).isDirectory()) {
        mkdirSync(destinationPath, { recursive: true });
      } else {
        mkdirSync(dirname(destinationPath), { recursive: true });
        copyFileSync(sourcePath, destinationPath);
      }
    } catch (error) {
      console.error(`[preview] could not mirror ${filename}: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
  sourceWatchers.push(watcher);
}

function startProcess(name, command, args, options) {
  const child = spawn(command, args, {
    cwd: options.cwd ?? root,
    env: options.env,
    stdio: "inherit",
    // Keep local services in the authorized preview process session. On macOS,
    // detached children can lose access to a project inside Documents while the
    // screen is locked and then stall before binding their ports.
    detached: false,
  });
  children.set(name, child);
  console.log(`[preview] ${name} started with pid ${child.pid}`);
  child.on("exit", (code, signal) => {
    children.delete(name);
    if (shuttingDown) return;
    console.error(`[preview] ${name} exited with ${signal ?? code ?? "unknown status"}; stopping local preview.`);
    stopAll(signal === "SIGINT" ? "SIGINT" : "SIGTERM");
    process.exitCode = typeof code === "number" && code !== 0 ? code : 1;
    setTimeout(() => process.exit(), 250);
  });
  return child;
}

function stopAll(signal = "SIGTERM") {
  shuttingDown = true;
  for (const watcher of sourceWatchers) watcher.close();
  for (const [name, child] of children) {
    try {
      child.kill(signal);
    } catch (error) {
      console.error(`[preview] could not stop ${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

process.on("SIGINT", () => {
  stopAll("SIGINT");
  setTimeout(() => process.exit(130), 500);
});
process.on("SIGTERM", () => {
  stopAll("SIGTERM");
  setTimeout(() => process.exit(143), 500);
});

startProcess("photo-attendance", photoPython, ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8100", "--workers", "1"], { env: photoAttendanceEnv, cwd: photoAttendanceRunRoot });
// Run the source watcher in local review so backend edits appear without a manual
// production build or service restart. The watcher remains a child of this
// supervisor, so an actual process failure still restarts the whole stack.
mirrorSourceChanges(resolve(backendRoot, "src"), resolve(backendRunRoot, "src"));
startProcess("api-compiler", resolve(backendRunRoot, "node_modules/.bin/tsc"), ["-p", "tsconfig.build.json", "--watch", "--preserveWatchOutput"], { env: backendEnv, cwd: backendRunRoot });
startProcess("api", process.execPath, ["--watch", "dist/main.js"], { env: backendEnv, cwd: backendRunRoot });
startProcess("web", "npm", ["--prefix", frontendRunRoot, "run", "dev", "--", "--host", "127.0.0.1", "--port", "8000", "--strictPort"], { env: frontendEnv });
if (process.env.LIVE_NGROK === "true") {
  const ngrokConfig = process.env.NGROK_CONFIG ?? resolve(homedir(), "Library/Application Support/ngrok/ngrok.yml");
  if (!existsSync(ngrokConfig)) throw new Error(`ngrok configuration is missing at ${ngrokConfig}`);
  startProcess("ngrok", "ngrok", ["http", "--config", ngrokConfig, "--log=stdout", "127.0.0.1:8000"], { env: { ...process.env, PATH: childPath } });
}
console.log(`[preview] live React app: ${appOrigin}`);
console.log(`[preview] API proxy target: ${apiOrigin}`);
console.log("[preview] private photo-attendance service: http://127.0.0.1:8100");
console.log(`[preview] localhost alias: ${appLocalhostOrigin}`);
