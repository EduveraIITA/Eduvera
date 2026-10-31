var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
import { BadRequestException, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { z } from "zod";
import { EXECUTION_CLOCK_PORT } from "../campus-model-core/execution-clock.port.js";
import { SchoolService } from "../school/school.service.js";
import { WorkspaceRepository } from "../workspace/workspace.repository.js";
const classIdSchema = z.string().uuid();
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use ISO date format YYYY-MM-DD.");
function canViewClass(action) {
    return action === "attendance.view" || action === "attendance.record";
}
let ResponsibilityClassWorkspaceService = class ResponsibilityClassWorkspaceService {
    workspace;
    school;
    clock;
    constructor(workspace, school, clock) {
        this.workspace = workspace;
        this.school = school;
        this.clock = clock;
    }
    async context(user, executionEnvironment, environmentView, requestedDate) {
        const schoolId = user.active_school_id;
        if (!schoolId)
            throw new BadRequestException("Choose an institution before opening Classes.");
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
        const classIds = [...new Set(classAssignments.map((assignment) => assignment.scope.id))];
        if (!classIds.length) {
            throw new ForbiddenException("No assigned class responsibility is currently available.");
        }
        return {
            date: requestedDate ? dateSchema.parse(requestedDate) : reading.local_date,
            classIds,
            recordableClassIds: [...new Set(classAssignments
                    .filter((assignment) => assignment.action_key === "attendance.record")
                    .map((assignment) => assignment.scope.id))],
            context: {
                institution_id: schoolId,
                environment: { kind: environmentView.mode, namespace_id: environmentView.namespace_id },
                as_of: reading.iso_instant,
            },
        };
    }
    async classes(user, executionEnvironment, environmentView, requestedDate) {
        const access = await this.context(user, executionEnvironment, environmentView, requestedDate);
        const result = await this.school.assignedClassesScreen(user, access.classIds, access.date, access.recordableClassIds);
        return { ...result, context: access.context };
    }
    async classDetail(user, executionEnvironment, environmentView, classSectionId, requestedDate) {
        const classId = classIdSchema.parse(classSectionId);
        const access = await this.context(user, executionEnvironment, environmentView, requestedDate);
        if (!access.classIds.includes(classId)) {
            throw new ForbiddenException("This class is not within your current responsibility.");
        }
        const result = await this.school.teacherAttendanceScreen(user, classId, access.date);
        if (access.recordableClassIds.includes(classId))
            return result;
        return {
            ...result,
            availability: {
                can_mark: false,
                reason: "Your current class responsibility allows viewing this register, but not recording attendance.",
            },
        };
    }
    async updates(user, executionEnvironment, environmentView, requestedDate) {
        const access = await this.context(user, executionEnvironment, environmentView, requestedDate);
        return this.school.assignedClassUpdates(user, access.classIds, access.date);
    }
};
ResponsibilityClassWorkspaceService = __decorate([
    Injectable(),
    __param(2, Inject(EXECUTION_CLOCK_PORT)),
    __metadata("design:paramtypes", [WorkspaceRepository,
        SchoolService, Object])
], ResponsibilityClassWorkspaceService);
export { ResponsibilityClassWorkspaceService };
//# sourceMappingURL=responsibility-class-workspace.service.js.map