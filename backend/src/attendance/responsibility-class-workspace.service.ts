import { BadRequestException, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { z } from "zod";
import type { ExecutionEnvironmentView } from "../auth/session-execution-environment.js";
import type { ExecutionEnvironment } from "../campus-model-core/execution-environment.contracts.js";
import { EXECUTION_CLOCK_PORT, type ExecutionClockPort } from "../campus-model-core/execution-clock.port.js";
import type { AuthUser } from "../common/request.js";
import { SchoolService } from "../school/school.service.js";
import { WorkspaceRepository } from "../workspace/workspace.repository.js";

const classIdSchema = z.string().uuid();
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use ISO date format YYYY-MM-DD.");

function canViewClass(action: string) {
  return action === "attendance.view" || action === "attendance.record";
}

@Injectable()
export class ResponsibilityClassWorkspaceService {
  constructor(
    private readonly workspace: WorkspaceRepository,
    private readonly school: SchoolService,
    @Inject(EXECUTION_CLOCK_PORT) private readonly clock: ExecutionClockPort,
  ) {}

  private async context(
    user: AuthUser,
    executionEnvironment: ExecutionEnvironment | null,
    environmentView: ExecutionEnvironmentView,
    requestedDate?: string,
  ) {
    const schoolId = user.active_school_id;
    if (!schoolId) throw new BadRequestException("Choose an institution before opening Classes.");
    if (environmentView.institution_id !== schoolId) {
      throw new BadRequestException("The selected execution environment does not match this institution.");
    }
    const snapshot = await this.workspace.load({
      user_id: user.id,
      school_id: schoolId,
      at: this.clock.now(),
      execution_environment: executionEnvironment,
    });
    if (snapshot.environment_namespace_id !== environmentView.namespace_id) {
      throw new ForbiddenException("Classes could not verify the active execution environment.");
    }
    const reading = this.clock.read({ institution_id: schoolId, time_zone: snapshot.institution.timezone });
    if (reading.namespace_id !== environmentView.namespace_id) {
      throw new ForbiddenException("Classes could not bind its clock to the active execution environment.");
    }
    const classAssignments = snapshot.assignments.filter((assignment) => assignment.scope.kind === "class"
      && assignment.scope.id
      && canViewClass(assignment.action_key));
    const classIds = [...new Set(classAssignments.map((assignment) => assignment.scope.id!))];
    if (!classIds.length) {
      throw new ForbiddenException("No assigned class responsibility is currently available.");
    }
    return {
      date: requestedDate ? dateSchema.parse(requestedDate) : reading.local_date,
      classIds,
      recordableClassIds: [...new Set(classAssignments
        .filter((assignment) => assignment.action_key === "attendance.record")
        .map((assignment) => assignment.scope.id!))],
      context: {
        institution_id: schoolId,
        environment: { kind: environmentView.mode, namespace_id: environmentView.namespace_id },
        as_of: reading.iso_instant,
      },
    };
  }

  async classes(
    user: AuthUser,
    executionEnvironment: ExecutionEnvironment | null,
    environmentView: ExecutionEnvironmentView,
    requestedDate?: string,
  ) {
    const access = await this.context(user, executionEnvironment, environmentView, requestedDate);
    const result = await this.school.assignedClassesScreen(
      user,
      access.classIds,
      access.date,
      access.recordableClassIds,
    );
    return { ...result, context: access.context };
  }

  async classDetail(
    user: AuthUser,
    executionEnvironment: ExecutionEnvironment | null,
    environmentView: ExecutionEnvironmentView,
    classSectionId: string,
    requestedDate?: string,
  ) {
    const classId = classIdSchema.parse(classSectionId);
    const access = await this.context(user, executionEnvironment, environmentView, requestedDate);
    if (!access.classIds.includes(classId)) {
      throw new ForbiddenException("This class is not within your current responsibility.");
    }
    const result = await this.school.teacherAttendanceScreen(user, classId, access.date);
    if (access.recordableClassIds.includes(classId)) return result;
    return {
      ...result,
      availability: {
        can_mark: false,
        reason: "Your current class responsibility allows viewing this register, but not recording attendance.",
      },
    };
  }

  async updates(
    user: AuthUser,
    executionEnvironment: ExecutionEnvironment | null,
    environmentView: ExecutionEnvironmentView,
    requestedDate?: string,
  ) {
    const access = await this.context(user, executionEnvironment, environmentView, requestedDate);
    return this.school.assignedClassUpdates(user, access.classIds, access.date);
  }
}
