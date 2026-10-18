export type Persona = "parent" | "student";
export type DemoPersona = Persona | "staff" | "admin" | "school_admin" | "company";

export class ApiError extends Error {
  readonly status: number;
  readonly details: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

function getCookie(name: string): string | undefined {
  const prefix = `${name}=`;
  return document.cookie
    .split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith(prefix))
    ?.slice(prefix.length);
}

function firstErrorMessage(value: unknown, depth = 0): string | undefined {
  if (depth > 4) return undefined;
  if (typeof value === "string" && value.trim()) return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const message = firstErrorMessage(item, depth + 1);
      if (message) return message;
    }
    return undefined;
  }
  if (typeof value === "object" && value !== null) {
    for (const item of Object.values(value)) {
      const message = firstErrorMessage(item, depth + 1);
      if (message) return message;
    }
  }
  return undefined;
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const method = (init.method ?? "GET").toUpperCase();
  headers.set("Accept", "application/json");
  if (typeof window !== "undefined" && /\.(ngrok-free\.dev|ngrok-free\.app|ngrok\.app|ngrok\.io)$/.test(window.location.hostname)) {
    headers.set("ngrok-skip-browser-warning", "true");
  }

  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    const csrfToken = getCookie("csrftoken");
    if (csrfToken) headers.set("X-CSRFToken", decodeURIComponent(csrfToken));
  }

  // Bound reads, including body download, so an interrupted connection cannot
  // leave a route loading forever. Writes retain their existing semantics:
  // aborting a save does not prove it was not committed by the server.
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(init.signal?.reason);
  if (init.signal?.aborted) forwardAbort();
  else init.signal?.addEventListener("abort", forwardAbort, { once: true });
  let timedOut = false;
  const timer = ["GET", "HEAD"].includes(method) ? setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 20_000) : undefined;
  let response: Response;
  let raw: string;
  try {
    response = await fetch(path, {
      ...init,
      headers,
      signal: controller.signal,
      credentials: "same-origin",
    });
    raw = await response.text();
  } catch (error) {
    if (timedOut) throw new ApiError("The school service is taking too long to respond. Please try again.", 408);
    throw error;
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener("abort", forwardAbort);
  }

  const contentType = response.headers.get("content-type") ?? "";
  // Proxies can return HTML even with status 200. Never treat that as a saved
  // command, nor display a proxy's entire document inside an error dialog.
  if (contentType.includes("text/html") || /^\s*(?:<!doctype\s+html|<html\b)/i.test(raw)) {
    throw new ApiError("The server connection was interrupted. Please try again. We could not confirm whether the action completed.", response.status);
  }
  let body: unknown = raw;
  if (contentType.includes("application/json") && raw) {
    try { body = JSON.parse(raw); }
    catch { throw new ApiError("The server returned an unreadable response. Please try again.", response.status); }
  }

  if (!response.ok) {
    if (response.status === 401 && typeof window !== "undefined") {
      window.dispatchEvent(new Event("omnischool:session-expired"));
    }
    const directDetail =
      typeof body === "object" && body !== null && "detail" in body ? body.detail : undefined;
    const nestedError =
      typeof body === "object" && body !== null && "error" in body &&
      typeof body.error === "object" && body.error !== null
        ? body.error
        : undefined;
    const message =
      typeof directDetail === "string"
        ? directDetail
        : nestedError && "detail" in nestedError
          ? typeof nestedError.detail === "string"
            ? nestedError.detail
            : firstErrorMessage(body) ?? "The request could not be completed."
          : firstErrorMessage(body) ?? `Request failed with status ${response.status}`;
    throw new ApiError(message, response.status, body);
  }

  return body as T;
}
