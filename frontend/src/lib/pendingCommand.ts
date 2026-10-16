import { ApiError } from "./api";

export interface PendingCommandScope {
  storageNamespace: string;
  institutionId: string;
  actorId: string;
  operation: string;
  targetId: string;
}

export interface PendingCommand {
  commandId: string;
  materialHash: string;
}

interface StoredCommand {
  version: 1;
  command_id: string;
  material_hash: string;
}

const memoryFallback = new Map<string, string>();

function normalized(value: unknown): unknown {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return value.map(normalized);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, normalized(item)]),
    );
  }
  return value;
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function fallbackHash(input: string) {
  // This fallback is only used when SubtleCrypto is unavailable. Two independently
  // seeded FNV-1a passes keep stored command material opaque. The server remains the
  // final idempotency and payload-collision authority.
  const run = (seed: bigint) => {
    let hash = seed;
    for (let index = 0; index < input.length; index += 1) {
      hash ^= BigInt(input.charCodeAt(index));
      hash = BigInt.asUintN(64, hash * 0x100000001b3n);
    }
    return hash.toString(16).padStart(16, "0");
  };
  return `${run(0xcbf29ce484222325n)}${run(0x84222325cbf29ce4n)}`;
}

export async function pendingCommandMaterialHash(material: unknown) {
  const input = JSON.stringify(normalized(material));
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
    return bytesToHex(new Uint8Array(digest));
  }
  return fallbackHash(input);
}

function storageKey(scope: PendingCommandScope) {
  return [scope.storageNamespace, scope.institutionId, scope.actorId, scope.operation, scope.targetId]
    .map(encodeURIComponent)
    .join(":");
}

function read(key: string): string | null {
  try {
    return (typeof window !== "undefined" ? window.sessionStorage.getItem(key) : null) ?? memoryFallback.get(key) ?? null;
  } catch {
    return memoryFallback.get(key) ?? null;
  }
}

function write(key: string, value: string) {
  memoryFallback.set(key, value);
  try {
    if (typeof window !== "undefined") window.sessionStorage.setItem(key, value);
  } catch {
    // Some private browser contexts disable storage. The in-memory fallback still
    // protects retries for the lifetime of the current page.
  }
}

function remove(key: string) {
  memoryFallback.delete(key);
  try {
    if (typeof window !== "undefined") window.sessionStorage.removeItem(key);
  } catch {
    // See write(): there may be no usable browser storage to clear.
  }
}

function parsedCommand(raw: string | null): StoredCommand | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<StoredCommand>;
    if (value.version !== 1 || typeof value.command_id !== "string" || typeof value.material_hash !== "string") return null;
    if (!/^[0-9a-f-]{36}$/i.test(value.command_id) || !/^[0-9a-f]{32,64}$/i.test(value.material_hash)) return null;
    return value as StoredCommand;
  } catch {
    return null;
  }
}

export async function pendingCommand(
  scope: PendingCommandScope,
  material: unknown,
): Promise<PendingCommand> {
  const key = storageKey(scope);
  const materialHash = await pendingCommandMaterialHash(material);
  const retained = parsedCommand(read(key));
  if (retained?.material_hash === materialHash) {
    return { commandId: retained.command_id, materialHash };
  }
  const commandId = globalThis.crypto.randomUUID();
  write(key, JSON.stringify({ version: 1, command_id: commandId, material_hash: materialHash } satisfies StoredCommand));
  return { commandId, materialHash };
}

export function clearPendingCommand(scope: PendingCommandScope, command: PendingCommand) {
  const key = storageKey(scope);
  const retained = parsedCommand(read(key));
  if (retained?.command_id === command.commandId && retained.material_hash === command.materialHash) remove(key);
}

export function isDefinitiveCommandFailure(error: unknown) {
  if (!(error instanceof ApiError)) return false;
  return error.status >= 400 && error.status < 500 && ![408, 425, 429].includes(error.status);
}

export function clearPendingCommandsForTests(storageNamespace?: string) {
  const prefix = storageNamespace ? `${encodeURIComponent(storageNamespace)}:` : null;
  for (const key of [...memoryFallback.keys()]) {
    if (!prefix || key.startsWith(prefix)) memoryFallback.delete(key);
  }
  if (typeof window === "undefined") return;
  for (let index = window.sessionStorage.length - 1; index >= 0; index -= 1) {
    const key = window.sessionStorage.key(index);
    if (key && (!prefix || key.startsWith(prefix))) window.sessionStorage.removeItem(key);
  }
}
