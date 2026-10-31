import { BadRequestException, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { z } from "zod";
import type { ExecutionEnvironment } from "../campus-model-core/execution-environment.contracts.js";
import { EXECUTION_CLOCK_PORT, type ExecutionClockPort } from "../campus-model-core/execution-clock.port.js";
import type { ExecutionEnvironmentView } from "../auth/session-execution-environment.js";
import type { AuthUser } from "../common/request.js";
import { WorkspaceRepository } from "../workspace/workspace.repository.js";
import type { ResponsibilityAssignmentProjection, WorkspaceScope } from "../workspace/workspace.contracts.js";
import { AttendanceModelService } from "../attendance-model/attendance-model.service.js";
import { ResponsibilityAttendanceRepository } from "./responsibility-attendance.repository.js";

const requestSchema = z.object({
  surface: z.enum(["registers", "coordination", "thresholds"]),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use ISO date format YYYY-MM-DD.").optional(),
  case_id: z.string().uuid().optional(),
}).strict();

function isRegisterAction(action: string) {
  return action === "attendance.view" || action === "attendance.record";
}

function isCoordinationAction(action: string) {
  return action.startsWith("followups.") || action.includes("coordination");
}

function actionScope(
  assignment: ResponsibilityAssignmentProjection,
  schoolId: string,
): { all: boolean; class_id: string | null } | null {
  if (assignment.scope.kind === "institution" && assignment.scope.id === schoolId) {
    return { all: true, class_id: null };
  }
  if (assignment.scope.kind === "class" && assignment.scope.id) {
    return { all: false, class_id: assignment.scope.id };
  }
  return null;
}

function authority(
  assignments: readonly ResponsibilityAssignmentProjection[],
  schoolId: string,
) {
  const viewClasses = new Set<string>();
  const recordClasses = new Set<string>();
  const coordinateClasses = new Set<string>();
  let viewAll = false;
  let recordAll = false;
  let coordinateAll = false;

  for (const assignment of assignments) {
    const scope = actionScope(assignment, schoolId);
    if (!scope) continue;
    if (assignment.action_key === "attendance.view" || assignment.action_key === "attendance.record") {
      if (scope.all) viewAll = true;
      else viewClasses.add(scope.class_id!);
    }
    if (assignment.action_key === "attendance.record") {
      if (scope.all) recordAll = true;
      else recordClasses.add(scope.class_id!);
    }
    if (isCoordinationAction(assignment.action_key)) {
      if (scope.all) coordinateAll = true;
      else coordinateClasses.add(scope.class_id!);
    }
  }

  return {
    register: {
      view_all: viewAll,
      record_all: recordAll,
      view_class_ids: [...viewClasses],
      record_class_ids: [...recordClasses],
    },
    coordination: {
      coordinate_all: coordinateAll,
      coordinate_class_ids: [...coordinateClasses],
    },
  };
}

@Injectable()
export class ResponsibilityAttendanceWorkspaceService {
  constructor(
    private readonly workspaceRepository: WorkspaceRepository,
    private readonly attendance: ResponsibilityAttendanceRepository,
    private readonly attendanceModel: AttendanceModelService,
    @Inject(EXECUTION_CLOCK_PORT) private readonly clock: ExecutionClockPort,
  ) {}

  async workspace(
    user: AuthUser,
    executionEnvironment: ExecutionEnvironment | null,
    environmentView: ExecutionEnvironmentView,
    raw: {
      surface: string | undefined;
      date: string | undefined;
      case_id: string | undefined;
    },
  ) {
    const parsed = requestSchema.parse(raw);
    const schoolId = user.active_school_id;
    if (!schoolId) throw new BadRequestException("Choose an institution before opening Attendance.");
    if (environmentView.institution_id !== schoolId) {
      throw new BadRequestException("The selected execution environment does not match this institution.");
    }

    const snapshot = await this.workspaceRepository.load({
      user_id: user.id,
      school_id: schoolId,
      at: this.clock.now(),
      execution_environment: executionEnvironment,
    });
    if (snapshot.environment_namespace_id !== environmentView.namespace_id) {
      throw new ForbiddenException("Attendance could not verify the active execution environment.");
    }

    const reading = this.clock.read({ institution_id: schoolId, time_zone: snapshot.institution.timezone });
    if (reading.institution_id !== schoolId || reading.namespace_id !== environmentView.namespace_id) {
      throw new ForbiddenException("Attendance could not bind its clock to the active execution environment.");
    }
    const date = parsed.date ?? reading.local_date;
    const allowed = authority(snapshot.assignments, schoolId);
    const surfaceAssignments = snapshot.assignments.filter((assignment) => parsed.surface !== "coordination"
      ? isRegisterAction(assignment.action_key) && actionScope(assignment, schoolId)
      : isCoordinationAction(assignment.action_key) && actionScope(assignment, schoolId));
    if (!surfaceAssignments.length) {
      throw new ForbiddenException("This Attendance responsibility is no longer assigned to you.");
    }

    const model = await this.attendanceModel.responsibilityWorkspace({
      school_id: schoolId,
      date,
      current_local_date: reading.local_date,
      ...allowed.register,
    });
    const registers = model.mode === "daily_class"
      ? await this.attendance.dailyRegisters({
        school_id: schoolId,
        date,
        current_local_date: reading.local_date,
        access: allowed.register,
      })
      : model.registers;
    const continuity = parsed.surface === "coordination"
      ? await this.attendance.continuity({
        school_id: schoolId,
        date,
        selected_case_id: parsed.case_id ?? null,
        access: allowed.coordination,
      })
      : null;
    const thresholds = parsed.surface === "thresholds"
      ? await this.attendance.thresholds({
        school_id: schoolId,
        date,
        access: allowed.register,
      })
      : null;
    const surfaceScopes = surfaceAssignments.map((assignment) => assignment.scope);

    return {
      surface: parsed.surface,
      date,
      mode: model.mode,
      campus_mode: model.campus_mode,
      capture_channels: model.capture_channels,
      registers,
      continuity,
      thresholds,
      authority: {
        capabilities: [...new Set(surfaceAssignments.map((assignment) => assignment.action_key))].sort(),
        scopes: [...new Map(surfaceScopes.map((scope: WorkspaceScope) => [
          `${scope.kind}:${scope.id ?? ""}`,
          scope,
        ])).values()],
      },
      context: {
        institution_id: schoolId,
        environment: {
          kind: environmentView.mode,
          namespace_id: environmentView.namespace_id,
        },
        as_of: reading.iso_instant,
      },
    };
  }
}
