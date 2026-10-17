import {
  CallHandler,
  ConflictException,
  ExecutionContext,
  GoneException,
  Injectable,
  type NestInterceptor,
} from "@nestjs/common";
import { Observable } from "rxjs";
import type { RequestWithContext } from "../common/request.js";
import {
  ExecutionDataPlaneError,
  ExecutionDataPlaneRegistry,
  ExecutionDataPlaneScope,
} from "../database/execution-data-plane.js";

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
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<RequestWithContext>();
    const environment = request.executionEnvironment;
    const requestPath = request.url.split("?", 1)[0]!;
    if (requestPath.startsWith("/api/v1/auth/")
      || requestPath.startsWith("/api/v1/development/campus-simulator/")) {
      return next.handle();
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
      const subscription = next.handle().subscribe(subscriber);
      return () => subscription.unsubscribe();
    }));
  }
}
