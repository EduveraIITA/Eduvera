export class ApiResponseError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = "ApiResponseError";
    this.status = status;
    this.body = body;
  }
}

function setCookieValues(headers) {
  if (typeof headers.getSetCookie === "function") return headers.getSetCookie();
  const combined = headers.get("set-cookie");
  return combined ? combined.split(/,(?=\s*[^;,\s]+=)/) : [];
}

export class ApiSession {
  constructor(origin, { fetchImpl = fetch, timeoutMs = 8_000, serviceToken = "", serviceUsername = "" } = {}) {
    this.origin = new URL(origin).origin;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.cookies = new Map();
    this.csrfToken = "";
    this.user = null;
    this.serviceToken = serviceToken;
    this.serviceUsername = serviceUsername;
  }

  captureCookies(response) {
    for (const value of setCookieValues(response.headers)) {
      const pair = value.split(";", 1)[0];
      const separator = pair.indexOf("=");
      if (separator > 0) this.cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
  }

  cookieHeader() {
    return [...this.cookies].map(([key, value]) => `${key}=${value}`).join("; ");
  }

  async request(path, { method = "GET", body, headers = {} } = {}) {
    if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//")) {
      throw new Error("Application requests must use a local absolute path.");
    }
    const upperMethod = method.toUpperCase();
    const requestHeaders = new Headers({ accept: "application/json", ...headers });
    if (this.serviceToken && this.serviceUsername) {
      requestHeaders.set("x-thatcampus-simulator-token", this.serviceToken);
      requestHeaders.set("x-thatcampus-simulator-user", this.serviceUsername);
    }
    const cookie = this.cookieHeader();
    if (cookie) requestHeaders.set("cookie", cookie);
    if (!["GET", "HEAD", "OPTIONS"].includes(upperMethod) && this.csrfToken) {
      requestHeaders.set("x-csrftoken", this.csrfToken);
    }
    let payload = body;
    if (body !== undefined && !(body instanceof FormData) && typeof body !== "string") {
      requestHeaders.set("content-type", "application/json");
      payload = JSON.stringify(body);
    } else if (typeof body === "string" && !requestHeaders.has("content-type")) {
      requestHeaders.set("content-type", "application/json");
    }
    const response = await this.fetchImpl(`${this.origin}${path}`, {
      method: upperMethod,
      headers: requestHeaders,
      ...(payload !== undefined ? { body: payload } : {}),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    this.captureCookies(response);
    const text = await response.text();
    let result = null;
    if (text) {
      try { result = JSON.parse(text); } catch { result = { message: text.slice(0, 500) }; }
    }
    if (!response.ok) {
      const nestedDetail = typeof result?.error?.detail === "string" ? result.error.detail : null;
      const directDetail = typeof result?.detail === "string" ? result.detail : null;
      const message = directDetail ?? nestedDetail ?? (typeof result?.message === "string"
        ? result.message
        : Array.isArray(result?.message) ? result.message.join(" ") : `Application API returned HTTP ${response.status}.`);
      throw new ApiResponseError(message, response.status, result);
    }
    return result;
  }

  async loginDemo(role) {
    const result = await this.request("/api/v1/auth/demo-session/", {
      method: "POST",
      body: { role },
    });
    if (!result?.user || result.demo_mode !== true) throw new Error(`The ${role} demo session was not available.`);
    const csrfCookie = this.cookies.get("csrftoken");
    this.csrfToken = csrfCookie ? decodeURIComponent(csrfCookie) : String(result.csrf_token ?? "");
    this.user = result.user;
    return result;
  }

  async login(identifier, password) {
    const csrf = await this.request("/api/v1/auth/csrf/");
    const csrfCookie = this.cookies.get("csrftoken");
    this.csrfToken = csrfCookie ? decodeURIComponent(csrfCookie) : String(csrf?.csrf_token ?? "");
    const result = await this.request("/api/v1/auth/login/", {
      method: "POST",
      body: { identifier, password },
    });
    if (result?.mfa_required) throw new Error(`The fixture actor ${identifier} requires MFA and cannot be automated.`);
    if (!result?.user) throw new Error(`The fixture actor ${identifier} could not start an application session.`);
    const refreshedCsrf = this.cookies.get("csrftoken");
    this.csrfToken = refreshedCsrf ? decodeURIComponent(refreshedCsrf) : String(result.csrf_token ?? this.csrfToken);
    this.user = result.user;
    return result;
  }

  async connectServiceIdentity() {
    if (!this.serviceToken || !this.serviceUsername) throw new Error("Hosted Campus Lab service identity is not configured.");
    const result = await this.request("/api/v1/auth/me/");
    if (!result?.user || result.user.username !== this.serviceUsername) {
      throw new Error(`The hosted fixture identity ${this.serviceUsername} was not accepted.`);
    }
    this.user = result.user;
    return result;
  }

  async enterCampusLabSimulation(virtualNow) {
    const result = await this.request("/api/v1/auth/campus-lab-simulation/", {
      method: "POST", body: virtualNow ? { virtual_now: virtualNow } : {},
    });
    if (result?.execution_environment?.mode !== "simulation") {
      throw new Error("The application did not bind this actor to the isolated Simulation environment.");
    }
    return result.execution_environment;
  }
}
