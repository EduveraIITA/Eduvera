import { ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import type { AuthenticatedRequest } from "../common/request.js";
import { config } from "../config.js";
import { DatabaseService } from "../database/database.service.js";

@Injectable()
export class CampusLabHostedService {
  constructor(private readonly db: DatabaseService) {}

  private async assertCambridgeMember(request: AuthenticatedRequest, requireAdmin = false): Promise<string> {
    const settings = config();
    if (!settings.HOSTED_CAMPUS_SIMULATOR_ENABLED || settings.DEPLOYMENT_ENVIRONMENT !== "stage") throw new NotFoundException();
    const schoolId = request.authUser.active_school_id;
    if (!schoolId) throw new ForbiddenException("Select the Cambridge testing campus first.");
    const membership = await this.db.selectFrom("school_memberships as m")
      .innerJoin("schools as s", "s.id", "m.school_id")
      .select("m.id")
      .where("m.user_id", "=", request.authUser.id)
      .where("m.school_id", "=", schoolId)
      .where("m.is_active", "=", true)
      .where("s.code", "=", "cis")
      .$if(requireAdmin, (query) => query.where("m.role", "=", "admin"))
      .executeTakeFirst();
    if (!membership) throw new ForbiddenException(requireAdmin
      ? "Campus Lab controls are available only to Cambridge test-campus administrators."
      : "Campus Lab is available only to Cambridge test-campus members.");
    return schoolId;
  }

  private async controlState(schoolId: string): Promise<{ enabled: boolean; clock_mode: "realtime" | "1m" | "15m" | "60m" }> {
    const record = await this.db.selectFrom("hosted_campus_lab_controls")
      .select(["enabled", "clock_mode"])
      .where("school_id", "=", schoolId)
      .executeTakeFirst();
    return { enabled: record?.enabled ?? true, clock_mode: record?.clock_mode ?? "60m" };
  }

  private async forward(path: "status" | "control", init: RequestInit = {}): Promise<unknown> {
    const settings = config();
    const response = await fetch(`${settings.HOSTED_CAMPUS_SIMULATOR_URL}/${path}`, {
      ...init,
      headers: {
        accept: "application/json",
        "x-campus-lab-key": settings.CAMPUS_LAB_PROXY_KEY!,
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(8_000),
    }).catch(() => null);
    if (!response) throw new ServiceUnavailableException("The Cambridge testing simulation is unavailable.");
    const body: unknown = await response.json().catch(() => ({ error: "The Cambridge testing simulation returned an invalid response." }));
    const detail = body && typeof body === "object" && "error" in body && typeof body.error === "string" ? body.error : null;
    if (!response.ok) throw new ServiceUnavailableException(detail ?? "The Cambridge testing simulation is unavailable.");
    return body;
  }

  async status(request: AuthenticatedRequest): Promise<unknown> {
    const schoolId = await this.assertCambridgeMember(request);
    return this.forward("control", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(await this.controlState(schoolId)),
    });
  }

  async control(request: AuthenticatedRequest): Promise<unknown> {
    const schoolId = await this.assertCambridgeMember(request, true);
    const body = request.body as { enabled?: unknown; clock_mode?: unknown } | undefined;
    if (typeof body?.enabled !== "boolean" || Object.keys(body).some((key) => !["enabled", "clock_mode"].includes(key))) {
      throw new ForbiddenException("Campus Lab control requires enabled and may include clock_mode.");
    }
    const enabled = body.enabled;
    const current = await this.controlState(schoolId);
    const clockMode = body.clock_mode === undefined ? current.clock_mode : body.clock_mode;
    if (!["realtime", "1m", "15m", "60m"].includes(String(clockMode))) {
      throw new ForbiddenException("Campus Lab clock mode must be realtime, 1m, 15m or 60m.");
    }
    await this.db.insertInto("hosted_campus_lab_controls").values({
      school_id: schoolId, enabled, clock_mode: clockMode as "realtime" | "1m" | "15m" | "60m", changed_by: request.authUser.id, changed_at: new Date(),
    }).onConflict((conflict) => conflict.column("school_id").doUpdateSet({
      enabled, clock_mode: clockMode as "realtime" | "1m" | "15m" | "60m", changed_by: request.authUser.id, changed_at: new Date(),
    })).execute();
    return this.forward("control", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled, clock_mode: clockMode }),
    });
  }
}
