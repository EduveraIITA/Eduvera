import fastifyStatic from "@fastify/static";
import type { FastifyInstance } from "fastify";
import { access, stat } from "node:fs/promises";
import { join } from "node:path";

// CanvasKit compiles the reviewed, same-origin WebAssembly asset. This does not
// enable JavaScript eval, remote scripts, blob scripts or a development server.
export const WEB_ASSET_SCRIPT_SOURCES = ["'self'", "'wasm-unsafe-eval'"] as const;

/** Only packaged public assets belong here; private uploads retain their API. */
export async function registerWebAssets(server: FastifyInstance, directory: string): Promise<void> {
  try { await access(join(directory, "index.html")); }
  catch { return; } // The API can start before its separate web export exists.

  for (const name of ["assets", "icons", "_expo", "skia"]) {
    const root = join(directory, name);
    try { if (!(await stat(root)).isDirectory()) continue; }
    catch { continue; }
    await server.register(fastifyStatic, {
      root, prefix: `/${name}/`, wildcard: true, decorateReply: false,
      index: false, list: false, dotfiles: "deny",
      allowedPath: path => !path.split(/[\\/]/u).some(part => part.startsWith("."))
        && !path.toLowerCase().endsWith(".map"),
    });
  }
}
