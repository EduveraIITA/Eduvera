import { ConflictException, ForbiddenException, GoneException } from "@nestjs/common";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { FastifyRequest } from "fastify";
import { defer, lastValueFrom, of } from "rxjs";
import type { AuthUser, RequestWithContext } from "../src/common/request.js";
import { AuthService } from "../src/auth/auth.service.js";
import { ExecutionEnvironmentInterceptor } from "../src/auth/execution-environment.interceptor.js";
import { SessionGuard } from "../src/auth/guards.js";
import {
  liveSessionExecutionEnvironment,
  simulationSessionExecutionEnvironment,
  unavailableSimulationSessionExecutionEnvironment,
} from "../src/auth/session-execution-environment.js";
import type { AuditService } from "../src/common/audit.service.js";
import type { DatabaseService } from "../src/database/database.service.js";
import {
  ExecutionDataPlaneError,
  ExecutionDataPlaneScope,
  type ExecutionDataPlaneRegistry,
} from "../src/database/execution-data-plane.js";
import type { RolesService } from "../src/roles/roles.service.js";
import type { TransientExecutionRunCatalog } from "../src/campus-model-core/transient-execution-run.contracts.js";

const SCHOOL_ID = "00000000-0000-4000-8000-000000000001";
const USER_ID = "00000000-0000-4000-8000-000000000002";
const SCENARIO_ID = "00000000-0000-4000-8000-000000000003";
const RUN_ID = "00000000-0000-4000-8000-000000000004";
const TOKEN_HASH = "session-token-hash";

const user: AuthUser = {
  id: USER_ID,
  username: "admin",
  email: "admin@example.test",
  first_name: "Admin",
  last_name: "User",
  role: "admin",
  is_active: true,
  active_school_id: SCHOOL_ID,
};

const run = {
  institution_id: SCHOOL_ID,
  scenario_id: SCENARIO_ID,
  run_id: RUN_ID,
  namespace_id: `scenario:${SCENARIO_ID}:run:${RUN_ID}` as const,
  virtual_now: "2026-10-18T04:00:00.000Z",
  time_zone: "Asia/Kolkata",
  source_snapshot_at: "2026-10-17T10:00:00.000Z",
  source_snapshot_ref: "sha256:snapshot",
  expires_at: "2099-10-18T05:00:00.000Z",
};

function query(result: unknown) {
  const builder: Record<string, (...args: unknown[]) => unknown> = {};
  for (const method of ["select", "where", "leftJoin", "innerJoin", "orderBy", "limit", "returning"]) {
    builder[method] = () => builder;
  }
  builder.executeTakeFirst = () => Promise.resolve(result);
  builder.execute = () => Promise.resolve(result ? [result] : []);
  return builder;
}

function serviceFixture(options: {
  admin?: boolean;
  publicDemo?: boolean;
  binding?: "active" | "expired";
  registryError?: ExecutionDataPlaneError;
} = {}) {
  const writes: Array<{ table: string; values: unknown }> = [];
  const deletes: string[] = [];
  const db: Record<string, unknown> = {};
  db.selectFrom = (table: string) => query(table === "school_memberships"
    ? (options.admin === false ? null : { id: "membership" })
    : {
      token_hash: TOKEN_HASH,
      csrf_token: "csrf-token",
      id: USER_ID,
      username: user.username,
      email: user.email,
      first_name: user.first_name,
      last_name: user.last_name,
      avatar_url: null,
      role: user.role,
      is_active: true,
      email_verified_at: null,
      active_school_id: SCHOOL_ID,
      is_public_demo: options.publicDemo ?? false,
      expires_at: new Date("2099-01-01T00:00:00.000Z"),
      last_seen_at: new Date(),
      environment_school_id: options.binding ? SCHOOL_ID : null,
      environment_scenario_id: options.binding ? SCENARIO_ID : null,
      environment_run_id: options.binding ? RUN_ID : null,
      environment_namespace_id: options.binding ? run.namespace_id : null,
      environment_expires_at: options.binding === "expired"
        ? new Date("2000-01-01T00:00:00.000Z")
        : options.binding ? new Date(run.expires_at) : null,
    });
  db.deleteFrom = (table: string) => {
    deletes.push(table);
    return query(null);
  };
  db.insertInto = (table: string) => {
    const builder = query(null) as Record<string, (...args: unknown[]) => unknown>;
    builder.values = (values: unknown) => {
      writes.push({ table, values });
      return builder;
    };
    builder.onConflict = (callback: (conflict: unknown) => unknown) => {
      const conflict: Record<string, (...args: unknown[]) => unknown> = {};
      conflict.column = () => conflict;
      conflict.doUpdateSet = () => conflict;
      callback(conflict);
      return builder;
    };
    return builder;
  };
  db.updateTable = () => {
    const builder = query(null) as Record<string, (...args: unknown[]) => unknown>;
    builder.set = () => builder;
    return builder;
  };
  db.transaction = () => ({ execute: (callback: (transaction: unknown) => unknown) => callback(db) });
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const resolveAuthorizedRun = vi.fn().mockResolvedValue(run);
  const catalog: TransientExecutionRunCatalog = { resolveAuthorizedRun };
  const registryError = options.registryError;
  const assertReady = registryError
    ? vi.fn().mockImplementation(() => { throw registryError; })
    : vi.fn().mockReturnValue({
      scenario_id: SCENARIO_ID,
      expires_at: run.expires_at,
      manifest_ref: "manifest:full-app-v1",
      checked_at: "2026-10-17T10:01:00.000Z",
      missing_modules: [],
      incomplete_capabilities: [],
      unsafe_effects: [],
    });
  const registry = { assertReady };
  const service = new AuthService(
    db as unknown as DatabaseService,
    audit as unknown as AuditService,
    {} as RolesService,
    catalog,
    registry as unknown as ExecutionDataPlaneRegistry,
  );
  return { service, writes, deletes, audit, resolveAuthorizedRun, registry };
}

describe("authenticated session execution environment", () => {
  it("constructs normalized Live and transient Simulation contexts without caller input", () => {
    const live = liveSessionExecutionEnvironment(SCHOOL_ID);
    const simulation = simulationSessionExecutionEnvironment(run, {
      manifest_ref: "manifest:full-app-v1",
      checked_at: "2026-10-17T10:01:00.000Z",
    });
    expect(live.view).toEqual({
      mode: "live",
      institution_id: SCHOOL_ID,
      namespace_id: `live:${SCHOOL_ID}`,
    });
    expect(simulation.view).toMatchObject({
      mode: "simulation",
      institution_id: SCHOOL_ID,
      scenario_id: SCENARIO_ID,
      run_id: RUN_ID,
      namespace_id: run.namespace_id,
      virtual_clock: { now: run.virtual_now, time_zone: "Asia/Kolkata" },
    });
    expect(simulation.environment?.capabilities.production_domain_commands).toBe(false);
    expect(() => simulation.environment?.kind === "simulation"
      && simulation.environment.virtual_clock.advanceBy(1)).toThrow(/cannot be advanced/);
  });

  it("represents an unavailable Simulation without inventing a virtual clock", () => {
    const unavailable = unavailableSimulationSessionExecutionEnvironment({
      school_id: SCHOOL_ID,
      scenario_id: SCENARIO_ID,
      run_id: RUN_ID,
      namespace_id: run.namespace_id,
      expires_at: run.expires_at,
    }, "data_plane_unavailable");

    expect(unavailable.environment).toBeNull();
    expect(unavailable.view).toEqual({
      mode: "simulation",
      unavailable: true,
      unavailable_reason: "data_plane_unavailable",
      institution_id: SCHOOL_ID,
      scenario_id: SCENARIO_ID,
      run_id: RUN_ID,
      namespace_id: run.namespace_id,
      expires_at: run.expires_at,
    });
    expect(unavailable.view).not.toHaveProperty("virtual_clock");
  });

  it("enters only a server-authorized, full-parity isolated run and persists the session binding", async () => {
    const fixture = serviceFixture();
    const request = { ip: "127.0.0.1", requestId: "request-1" } as FastifyRequest;
    const result = await fixture.service.selectExecutionEnvironment(
      user,
      TOKEN_HASH,
      { mode: "simulation", run_id: RUN_ID },
      request,
    );
    expect(fixture.resolveAuthorizedRun).toHaveBeenCalledWith({
      actor_id: USER_ID,
      institution_id: SCHOOL_ID,
      run_id: RUN_ID,
    });
    expect(fixture.registry.assertReady).toHaveBeenCalledWith({
      institutionId: SCHOOL_ID,
      runId: RUN_ID,
      namespaceId: run.namespace_id,
    });
    expect(fixture.writes).toContainEqual(expect.objectContaining({
      table: "auth_session_execution_environments",
      values: expect.objectContaining({ token_hash: TOKEN_HASH, school_id: SCHOOL_ID, run_id: RUN_ID }),
    }));
    expect(result.execution_environment).toMatchObject({ mode: "simulation", run_id: RUN_ID });
    expect(fixture.audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "auth.execution_environment.entered_simulation",
      actorId: USER_ID,
      schoolId: SCHOOL_ID,
    }));
  });

  it("requires an active institution administrator and rejects public demo activation", async () => {
    const request = { ip: "127.0.0.1" } as FastifyRequest;
    await expect(serviceFixture({ admin: false }).service.selectExecutionEnvironment(
      user, TOKEN_HASH, { mode: "simulation", run_id: RUN_ID }, request,
    )).rejects.toBeInstanceOf(ForbiddenException);
    await expect(serviceFixture({ publicDemo: true }).service.selectExecutionEnvironment(
      user, TOKEN_HASH, { mode: "simulation", run_id: RUN_ID }, request,
    )).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("keeps aggregate or missing data-plane runs non-enterable", async () => {
    const unavailable = new ExecutionDataPlaneError(
      "data_plane_not_found",
      "No complete isolated plane exists.",
    );
    const fixture = serviceFixture({ registryError: unavailable });
    await expect(fixture.service.selectExecutionEnvironment(
      user,
      TOKEN_HASH,
      { mode: "simulation", run_id: RUN_ID },
      { ip: "127.0.0.1" } as FastifyRequest,
    )).rejects.toBeInstanceOf(ConflictException);
    expect(fixture.writes).not.toContainEqual(expect.objectContaining({
      table: "auth_session_execution_environments",
    }));
  });

  it("returns gone when the selected Simulation run no longer exists", async () => {
    const fixture = serviceFixture();
    fixture.resolveAuthorizedRun.mockResolvedValueOnce(null);

    await expect(fixture.service.selectExecutionEnvironment(
      user,
      TOKEN_HASH,
      { mode: "simulation", run_id: RUN_ID },
      { ip: "127.0.0.1" } as FastifyRequest,
    )).rejects.toBeInstanceOf(GoneException);
  });

  it("returns to Live by deleting only the authenticated session binding and auditing the change", async () => {
    const fixture = serviceFixture();
    const result = await fixture.service.selectExecutionEnvironment(
      user,
      TOKEN_HASH,
      { mode: "live" },
      { ip: "127.0.0.1" } as FastifyRequest,
    );
    expect(fixture.deletes).toContain("auth_session_execution_environments");
    expect(result.execution_environment).toMatchObject({ mode: "live", institution_id: SCHOOL_ID });
    expect(fixture.audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "auth.execution_environment.returned_live",
    }));
  });

  it("resets to Live on institution switch", async () => {
    const fixture = serviceFixture({ binding: "active" });
    const result = await fixture.service.selectSchool(user, TOKEN_HASH, { school_id: SCHOOL_ID });
    expect(fixture.deletes).toContain("auth_session_execution_environments");
    expect(result.execution_environment).toMatchObject({ mode: "live", institution_id: SCHOOL_ID });
  });

  it.each([
    ["expired binding", serviceFixture({ binding: "expired" })],
    ["lost isolated registry", serviceFixture({
      binding: "active",
      registryError: new ExecutionDataPlaneError("data_plane_not_found", "gone"),
    })],
  ])("keeps an %s tombstoned until the user explicitly returns to Live", async (_label, fixture) => {
    const result = await fixture.service.currentExecutionEnvironment(user, TOKEN_HASH);
    expect(result.execution_environment).toMatchObject({
      mode: "simulation",
      unavailable: true,
      institution_id: SCHOOL_ID,
      run_id: RUN_ID,
    });
    expect(fixture.deletes).not.toContain("auth_session_execution_environments");
    expect(result.execution_environment).not.toHaveProperty("virtual_clock");
  });

  it("exposes a lost Simulation explicitly through session inspection without deleting its binding", async () => {
    const fixture = serviceFixture({
      binding: "active",
      registryError: new ExecutionDataPlaneError("data_plane_not_found", "gone"),
    });
    const identity = await fixture.service.resolveSession("raw-session-token");
    expect(identity?.executionEnvironmentView).toMatchObject({
      mode: "simulation",
      unavailable: true,
      unavailable_reason: "data_plane_unavailable",
      institution_id: SCHOOL_ID,
      run_id: RUN_ID,
    });
    expect(identity?.executionEnvironment).toBeNull();
    expect(fixture.deletes).not.toContain("auth_session_execution_environments");
  });

  it("fails ordinary APIs closed before later guards while leaving auth control-plane recovery available", async () => {
    process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:5432/omnischool_test";
    const unavailable = unavailableSimulationSessionExecutionEnvironment({
      school_id: SCHOOL_ID,
      scenario_id: SCENARIO_ID,
      run_id: RUN_ID,
      namespace_id: run.namespace_id,
      expires_at: run.expires_at,
    }, "data_plane_unavailable");
    const auth = {
      resolveSession: vi.fn().mockResolvedValue({
        user,
        tokenHash: TOKEN_HASH,
        csrfToken: "csrf",
        publicDemo: false,
        executionEnvironment: unavailable.environment,
        executionEnvironmentView: unavailable.view,
      }),
    };
    const guard = new SessionGuard(
      { getAllAndOverride: () => false } as never,
      auth as never,
      { consume: () => null } as never,
    );
    const request = {
      url: "/api/v1/schools/one/timetable/",
      headers: {},
      cookies: { omnischool_session: "signed" },
      unsignCookie: () => ({ valid: true, value: "raw-token" }),
    } as unknown as RequestWithContext;
    const context = {
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({ getRequest: () => request }),
    } as never;

    await expect(guard.canActivate(context)).rejects.toMatchObject({ status: 410 });
    expect(request.executionEnvironmentView).toEqual(unavailable.view);

    request.url = "/api/v1/auth/execution-environment/";
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it("SessionGuard ignores caller environment headers and trusts only resolved session context", async () => {
    process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:5432/omnischool_test";
    const live = liveSessionExecutionEnvironment(SCHOOL_ID);
    const request = {
      headers: { "x-thatcampus-execution-environment": "simulation" },
      cookies: { omnischool_session: "signed" },
      unsignCookie: () => ({ valid: true, value: "raw-token" }),
    } as unknown as RequestWithContext;
    const auth = {
      resolveSession: vi.fn().mockResolvedValue({
        user,
        tokenHash: TOKEN_HASH,
        csrfToken: "csrf",
        publicDemo: false,
        executionEnvironment: live.environment,
        executionEnvironmentView: live.view,
      }),
    };
    const guard = new SessionGuard(
      { getAllAndOverride: () => false } as never,
      auth as never,
      { consume: () => null } as never,
    );
    const context = {
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({ getRequest: () => request }),
    } as never;
    expect(await guard.canActivate(context)).toBe(true);
    expect(request.executionEnvironmentView).toEqual(live.view);
  });

  it("keeps auth routes on the Live control plane and scopes normal APIs to the selected environment", async () => {
    const scope = new ExecutionDataPlaneScope();
    const registry = { assertEnvironmentReady: vi.fn() };
    const interceptor = new ExecutionEnvironmentInterceptor(
      scope,
      registry as unknown as ExecutionDataPlaneRegistry,
    );
    const live = liveSessionExecutionEnvironment(SCHOOL_ID).environment!;
    let observed: unknown;
    const next = {
      handle: () => defer(() => {
        observed = scope.current();
        return of("ok");
      }),
    };
    const domainRequest = { url: "/api/v1/schools/one/timetable/", executionEnvironment: live };
    const domainContext = {
      switchToHttp: () => ({ getRequest: () => domainRequest }),
    } as never;
    expect(await lastValueFrom(interceptor.intercept(domainContext, next))).toBe("ok");
    expect(observed).toBe(live);
    expect(registry.assertEnvironmentReady).toHaveBeenCalledWith(live);

    registry.assertEnvironmentReady.mockClear();
    observed = "not-called";
    const authRequest = { url: "/api/v1/auth/execution-environment/", executionEnvironment: live };
    const authContext = {
      switchToHttp: () => ({ getRequest: () => authRequest }),
    } as never;
    expect(await lastValueFrom(interceptor.intercept(authContext, next))).toBe("ok");
    expect(observed).toBeUndefined();
    expect(registry.assertEnvironmentReady).not.toHaveBeenCalled();
  });

  it("intercepts an unavailable Simulation before an ordinary controller can run", () => {
    const scope = new ExecutionDataPlaneScope();
    const registry = { assertEnvironmentReady: vi.fn() };
    const interceptor = new ExecutionEnvironmentInterceptor(
      scope,
      registry as unknown as ExecutionDataPlaneRegistry,
    );
    const unavailable = unavailableSimulationSessionExecutionEnvironment({
      school_id: SCHOOL_ID,
      scenario_id: SCENARIO_ID,
      run_id: RUN_ID,
      namespace_id: run.namespace_id,
      expires_at: run.expires_at,
    }, "data_plane_unavailable");
    const request = {
      url: "/api/v1/schools/one/timetable/",
      executionEnvironment: null,
      executionEnvironmentView: unavailable.view,
    };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as never;
    const next = { handle: vi.fn(() => of("must not run")) };

    expect(() => interceptor.intercept(context, next)).toThrow(GoneException);
    expect(next.handle).not.toHaveBeenCalled();
    expect(registry.assertEnvironmentReady).not.toHaveBeenCalled();
  });

  it("defines a cascade-bound, tenant/run constrained database binding", () => {
    const migration = readFileSync(
      new URL("../migrations/123_auth_session_execution_environment.sql", import.meta.url),
      "utf8",
    );
    expect(migration).toContain("REFERENCES auth_sessions(token_hash) ON DELETE CASCADE");
    expect(migration).toContain("REFERENCES schools(id) ON DELETE CASCADE");
    expect(migration).toContain("namespace_id = 'scenario:' || scenario_id::text || ':run:' || run_id::text");
    expect(migration).toContain("expires_at > bound_at");
  });
});
