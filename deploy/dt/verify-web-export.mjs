import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function productionApiOrigin(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Set EXPO_PUBLIC_API_URL to the production HTTPS origin.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash
      || url.hostname === 'localhost' || url.hostname.endsWith('.invalid') || url.hostname === 'trycloudflare.com' || url.hostname.endsWith('.trycloudflare.com')
      || /^\[|^\d+(?:\.\d+){3}$/.test(url.hostname)) throw new Error('The web export requires a permanent production HTTPS origin.');
  return url.origin;
}

async function filesBelow(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink()) throw new Error('Web export must contain ordinary files, not symbolic links.');
    const file = join(root, entry.name);
    if (entry.isDirectory()) files.push(...await filesBelow(file));
    else if (entry.isFile()) files.push(file);
    else throw new Error('Web export contains an unsupported filesystem entry.');
  }
  return files;
}

/** Build-only assertion: serve the sole production Expo bundle and its local WASM. */
export async function verifyWebExport(directory, apiUrl) {
  const origin = productionApiOrigin(apiUrl), root = resolve(directory), files = await filesBelow(root);
  const html = await readFile(join(root, 'index.html'), 'utf8');
  if (!/<div\b[^>]*\bid=["']root["']/i.test(html)) throw new Error('The Expo root document is missing.');
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)].map(match => match[1]);
  if (!scripts.length) throw new Error('The Expo entry script is missing.');
  for (const source of scripts) {
    const url = new URL(source, origin);
    if (url.origin !== origin || !/^\/_expo\/static\/js\/web\/[^/]+\.js$/.test(url.pathname) || url.search || url.hash)
      throw new Error('Web export contains a non-production or external entry script.');
    const filename = resolve(root, `.${decodeURIComponent(url.pathname)}`);
    if (!files.includes(filename)) throw new Error('The Expo entry script does not exist in this export.');
  }
  const wasm = files.filter(file => /^skia\/canvaskit-\d+\.\d+\.\d+-[a-f0-9]{12}\.wasm$/.test(relative(root, file).replaceAll('\\', '/')));
  if (wasm.length !== 1) throw new Error('The export must contain one dependency-matched CanvasKit WASM.');
  const payload = await readFile(wasm[0]), sha256 = createHash('sha256').update(payload).digest('hex');
  if (!payload.subarray(0, 8).equals(Buffer.from([0, 97, 115, 109, 1, 0, 0, 0])) || !wasm[0].endsWith(`-${sha256.slice(0, 12)}.wasm`))
    throw new Error('The CanvasKit payload does not match its versioned filename.');
  await readFile(join(dirname(wasm[0]), 'canvaskit-LICENSE.txt'));
  if (files.some(file => /\/DejaVuSans\.[^/]+\.ttf$/.test(file)))
    await readFile(join(root, 'licenses/DejaVuSans-LICENSE.txt'));
  for (const file of files) {
    if (!/\.(?:html|js|css|json|map)$/i.test(file)) continue;
    const text = await readFile(file, 'utf8');
    if (/\b(?:[a-z0-9-]+\.)*trycloudflare\.com\b/i.test(text)) throw new Error('A temporary tunnel origin leaked into the production web export.');
    if (/\.map$/i.test(file)) throw new Error('Production web export must not publish source maps.');
  }
  return { origin, entry_scripts: scripts.length, files: files.length, canvaskit_sha256: sha256 };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv[2] === '--origin-only') productionApiOrigin(process.argv[3]);
    else console.log(JSON.stringify(await verifyWebExport(process.argv[2], process.argv[3])));
  } catch (cause) {
    console.error(cause instanceof Error ? cause.message : 'The production web export could not be verified.');
    process.exitCode = 1;
  }
}
