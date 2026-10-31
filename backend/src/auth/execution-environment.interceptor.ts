import {
  CallHandler,
  ConflictException,
  ExecutionContext,
  GoneException,
  Injectable,
  Optional,
  type NestInterceptor,
} from "@nestjs/common";
import { Observable, from, mergeMap } from "rxjs";
import { AssignedWorkAccess } from './assigned-work-access.js';
import { SimulationService } from "../simulation/simulation.service.js";
import { liveSessionExecutionEnvironment } from "./session-execution-environment.js";
import type { RequestWithContext } from "../common/request.js";
import {
  ExecutionDataPlaneError,
  ExecutionDataPlaneRegistry,
  ExecutionDataPlaneScope,
} from "../database/execution-data-plane.js";

const simulationMultipartAdapters = [
  /^\/api\/v1\/chat\/conversations\/[^/]+\/messages\/?$/u,
  /^\/api\/v1\/leave-requests\/?$/u,
  /^\/api\/v1\/leave-requests\/[^/]+\/documents\/?$/u,
  /^\/api\/v1\/schools\/[^/]+\/assessments\/[^/]+\/results\/[^/]+\/evidence\/?$/u,
  /^\/api\/v1\/learning\/assignments\/[^/]+\/(?:work|people)\/[^/]+\/files\/?$/u,
  /^\/api\/v1\/schools\/[^/]+\/facilities\/repairs\/[^/]+\/photos\/?$/u,
  /^\/api\/v1\/gate\/schools\/[^/]+\/visitors\/?$/u,
  /^\/api\/v1\/photo-attendance\/students\/[^/]+\/samples\/?$/u,
  /^\/api\/v1\/photo-attendance\/classes\/[^/]+\/analyze\/?$/u,
] as const;

/** A bounded description of an accepted response, never a copy of request data. */
export function simulationDraftChangeDescription(method: string,path: string,value: unknown) {
  const record=value && typeof value==='object' && !Array.isArray(value) ? value as Record<string,unknown> : {};
  const activityPlan=/\/activities\/plans(?:\/|$)/u.test(path);
  const domain=activityPlan || /timetable|schedule|day-plan/u.test(path) ? 'timetable'
    : /\/activities\/registers(?:\/|$)|attendance/u.test(path) ? 'attendance'
      : /staff.*leave/u.test(path) ? 'staff_availability'
        : /people|students|enrollment/u.test(path) ? 'people'
          : /operating-rules/u.test(path) ? 'operating_rules'
            : /\/accommodation(?:\/|$)/u.test(path) ? 'accommodation'
              : /\/facilities(?:\/|$)/u.test(path) ? 'facilities'
              : /campus|spaces|institution-setup/u.test(path) ? 'campus_setup' : 'campus_operations';
  const title=typeof record.title==='string' ? record.title.trim().slice(0,160) : null;
  const action=activityPlan ? /\/publish\/?$/u.test(path) ? 'Published activity'
    : /\/cancel\/?$/u.test(path) ? 'Cancelled activity'
      : /\/revise\/?$/u.test(path) ? 'Prepared activity change'
        : method==='POST' ? 'Created activity draft' : 'Updated activity draft' : null;
  return {domain,summary:action ? `${action}${title ? `: ${title}` : ''}`
    : `${method==='DELETE' ? 'Removed a record in' : 'Updated'} ${domain.replaceAll('_',' ')}`,
    response_id:typeof record.id==='string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(record.id) ? record.id : null,
    revision:typeof record.revision==='number' && Number.isSafeInteger(record.revision) && record.revision>=0 ? record.revision : null};
}

/** Reviewed multipart writes backed by the run-local artifact port. */
export function hasSimulationMultipartAdapter(method: string, requestPath: string): boolean {
  return method.toUpperCase() === "POST"
    && simulationMultipartAdapters.some((pattern) => pattern.test(requestPath));
}

export function hasSimulationCalendarAdapter(method: string, requestPath: string): boolean {
  const verb = method.toUpperCase();
  if (verb === "GET" && /^\/api\/v1\/calendar-connections\/?$/u.test(requestPath)) return true;
  if (verb === "GET" && requestPath === "/api/v1/calendar-connections/export.ics") return true;
  if (verb === "POST" && /^\/api\/v1\/calendar-connections\/subscriptions\/?$/u.test(requestPath)) return true;
  if (verb === "DELETE" && /^\/api\/v1\/calendar-connections\/subscriptions\/[^/]+\/?$/u.test(requestPath)) return true;
  return verb === "GET"
    && /^\/api\/v1\/calendar-connections\/subscriptions\/[^/]+\/preview\.ics$/u.test(requestPath);
}

/**
 * Binds every ordinary domain request to the environment selected by the
 * authenticated server session. Auth routes remain on the Live control plane so
 * session identity, expiry and Return to Live can never be written into an
 * isolated scenario database.
 */
@Injectable()
export class ExecutionEnvironmentInterceptor implements NestInterceptor {
  constructor(
    private readonly scope: ExecutionDataPlaneScope,
    private readonly registry: ExecutionDataPlaneRegistry,
    @Optional() private readonly simulations?: SimulationService,
    @Optional() private readonly assignedWork?: AssignedWorkAccess,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<RequestWithContext>();
    const environment = request.executionEnvironment;
    const requestPath = request.url.split("?", 1)[0]!;
    if (requestPath.startsWith("/api/v1/auth/")
      || /^\/api\/v1\/schools\/[^/]+\/simulation(?:\/|$)/u.test(requestPath)
      || requestPath.startsWith("/api/v1/development/campus-simulator/")) {
      return next.handle();
    }
    const expectedNamespace = request.headers?.["x-thatcampus-execution-environment"];
    const selectedNamespace = request.executionEnvironmentView?.namespace_id ?? environment?.namespace_id ?? "live:global";
    if (typeof expectedNamespace === "string" && expectedNamespace !== selectedNamespace) {
      throw new ConflictException({ code: "execution_environment_changed",
        message: "This session selected another campus environment. Confirm it before continuing." });
    }
    if (request.executionEnvironmentView?.mode === "simulation"
      && request.executionEnvironmentView.unavailable === true) {
      throw new GoneException({
        message: "This Simulation is unavailable. Return to Live to continue.",
        code: "simulation_environment_unavailable",
        reason: request.executionEnvironmentView.unavailable_reason,
        run_id: request.executionEnvironmentView.run_id,
      });
    }
    if (!environment) return next.handle();
    if (environment.kind === "simulation") {
      const view = request.executionEnvironmentView;
      if (view?.mode === "simulation" && view.unavailable !== true
        && (view.run_status === "completed" || view.run_status === "stopped")
        && !["GET", "HEAD", "OPTIONS"].includes(request.method)) {
        throw new ConflictException({ code: "simulation_run_read_only",
          message: "This Simulation has ended. Duplicate it as a scenario to explore further changes." });
      }
      const contentType = request.headers?.["content-type"];
      const unsupportedMultipart = typeof contentType === "string"
        && contentType.startsWith("multipart/")
        && !hasSimulationMultipartAdapter(request.method, requestPath);
      const unsafeCalendarConnection = requestPath.startsWith("/api/v1/calendar-connections")
        && !hasSimulationCalendarAdapter(request.method, requestPath);
      if (unsupportedMultipart
        || /^\/api\/v1\/(?:agent|ai|company)(?:\/|$)/u.test(requestPath)
        || unsafeCalendarConnection) {
        throw new ConflictException({ code: "simulation_adapter_unavailable",
          message: "This connected service is not modelled in this Simulation. No Live service was contacted." });
      }
    }
    try {
      this.registry.assertEnvironmentReady(environment);
    } catch (error) {
      if (error instanceof ExecutionDataPlaneError) {
        throw new ConflictException({
          message: "This Simulation environment is no longer available. Return to Live or open another ready run.",
          code: error.code,
        });
      }
      throw error;
    }
    return new Observable((subscriber) => this.scope.run(environment, () => {
      const recordChange = environment.kind === "simulation" && this.simulations && request.authUser
        && request.executionEnvironmentView?.mode === "simulation" && request.executionEnvironmentView.unavailable !== true
        && request.executionEnvironmentView.run_status === "draft" && !["GET", "HEAD", "OPTIONS"].includes(request.method);
      const handle = this.assignedWork
        ? from(this.assignedWork.assertRequest(request)).pipe(mergeMap(() => next.handle()))
        : next.handle();
      const response = recordChange ? handle.pipe(mergeMap(async (value: unknown) => {
        const description=simulationDraftChangeDescription(request.method,requestPath,value);
        const live = liveSessionExecutionEnvironment(environment.institution_id).environment!;
        const ids = requestPath.match(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/gu) ?? [];
        await this.scope.run(live, async () => this.simulations!.recordChangeBestEffort(request.authUser!, environment.institution_id, environment.run_id, {
          domain:description.domain,change_kind:request.method.toLowerCase(),target_ref:description.response_id ?? ids.filter((id) => id !== environment.institution_id).at(-1) ?? null,
          summary:description.summary,
          source_revision:description.revision===null ? `request:${request.requestId}` : `revision:${description.revision}`,idempotency_key:request.requestId,
        })).catch(() => false);
        return value;
      })) : handle;
      const subscription = response.subscribe(subscriber);
      return () => subscription.unsubscribe();
    }));
  }
}
