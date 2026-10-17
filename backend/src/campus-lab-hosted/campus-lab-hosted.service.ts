import { ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import type { AuthenticatedRequest } from "../common/request.js";
import { config } from "../config.js";
import { DatabaseService } from "../database/database.service.js";

@Injectable()
export class CampusLabHostedService {
  constructor(private readonly db: DatabaseService) {}

  private async assertCambridgeAdmin(request: AuthenticatedRequest): Promise<string> {
    const settings = config();
    if (!settings.HOSTED_CAMPUS_SIMULATOR_ENABLED || settings.DEPLOYMENT_ENVIRONMENT !== "stage") throw new NotFoundException();
    const schoolId = request.authUser.active_school_id;
    if (!schoolId) throw new ForbiddenException("Select the Cambridge testing campus first.");
    const membership = await this.db.selectFrom("school_memberships as m")
      .innerJoin("schools as s", "s.id", "m.school_id")
      .select("m.id")
      .where("m.user_id", "=", request.authUser.id)
      .where("m.school_id", "=", schoolId)
      .where("m.role", "=", "admin")
      .where("m.is_active", "=", true)
      .where("s.code", "=", "cis")
      .executeTakeFirst();
    if (!membership) throw new ForbiddenException("Campus Lab is available only to Cambridge test-campus administrators.");
    return schoolId;
  }

  private async enabled(schoolId: string): Promise<boolean> {
    return (await this.db.selectFrom("hosted_campus_lab_controls").select("enabled").where("school_id", "=", schoolId).executeTakeFirst())?.enabled ?? true;
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
    const schoolId = await this.assertCambridgeAdmin(request);
    return this.forward("control", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: await this.enabled(schoolId) }),
    });
  }

  async control(request: AuthenticatedRequest): Promise<unknown> {
    const schoolId = await this.assertCambridgeAdmin(request);
    const body = request.body as { enabled?: unknown } | undefined;
    if (typeof body?.enabled !== "boolean" || Object.keys(body).some((key) => key !== "enabled")) {
      throw new ForbiddenException("Campus Lab control requires a boolean enabled value.");
    }
    const enabled = body.enabled;
    await this.db.insertInto("hosted_campus_lab_controls").values({
      school_id: schoolId, enabled, changed_by: request.authUser.id, changed_at: new Date(),
    }).onConflict((conflict) => conflict.column("school_id").doUpdateSet({
      enabled, changed_by: request.authUser.id, changed_at: new Date(),
    })).execute();
    return this.forward("control", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
  }
}
