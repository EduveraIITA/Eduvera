import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const label = "dev.eduvera.local-preview";
const domain = `gui/${process.getuid()}`;
const target = `${domain}/${label}`;
const action = process.argv[2] ?? "status";
const run = (...args) => spawnSync("launchctl", args, { encoding: "utf8" });
const xml = (value) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
if (process.platform !== "darwin") throw new Error("Use Docker Compose for managed preview outside macOS.");
if (!["start", "stop", "restart", "status"].includes(action)) throw new Error("Usage: node scripts/local-preview.mjs start|stop|restart|status");

if (action === "start") {
  if (run("print", target).status !== 0) {
    const runtime = resolve(root, ".runtime");
    mkdirSync(runtime, { recursive: true });
    const plist = resolve(runtime, `${label}.plist`);
    writeFileSync(plist, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array><string>${xml(process.execPath)}</string><string>${xml(resolve(root, "scripts/preview-server.mjs"))}</string></array>
<key>WorkingDirectory</key><string>${xml(root)}</string>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>ThrottleInterval</key><integer>10</integer>
<key>ExitTimeOut</key><integer>15</integer>
<key>EnvironmentVariables</key><dict>
<key>NODE_DISABLE_COMPILE_CACHE</key><string>1</string>
<key>LIVE_NGROK</key><string>true</string>
</dict>
<key>StandardOutPath</key><string>${xml(resolve(runtime, "preview.log"))}</string>
<key>StandardErrorPath</key><string>${xml(resolve(runtime, "preview.error.log"))}</string>
</dict></plist>\n`, { mode: 0o600 });
    const result = run("bootstrap", domain, plist);
    if (result.status !== 0) throw new Error(result.stderr || "Could not register the local preview service.");
  }
  console.log("Managed live preview started at http://127.0.0.1:8000 with React hot updates. Logs: .runtime/preview*.log");
} else if (action === "stop") {
  const result = run("bootout", target);
  if (result.status !== 0) throw new Error(result.stderr);
  console.log("Local preview stopped.");
} else if (action === "restart") {
  const result = run("kickstart", "-k", target);
  if (result.status !== 0) throw new Error(result.stderr);
  console.log("Live preview restarted at http://127.0.0.1:8000.");
} else {
  const result = run("print", target);
  console.log(result.status === 0 ? result.stdout.split("\n").filter((line) => /state =|pid =|last exit code =|runs =/.test(line)).join("\n") : "Local preview is not registered. Run: node scripts/local-preview.mjs start");
}
