import { TeacherFeedbackModule } from "./teacher-feedback/teacher-feedback.module.js";
import { CompanyModule } from "./company/company.module.js";
import { PrincipalInsightsModule } from "./principal-insights/principal-insights.module.js";
import { SchedulePlanningModule } from "./schedule-planning/schedule-planning.module.js";
import { RolesModule } from "./roles/roles.module.js";
import { PermissionGuard } from "./roles/permission.guard.js";
import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AiModule } from "./ai/ai.module.js";
import { CoordinationModule } from "./coordination/coordination.module.js";
import { PeopleModule } from "./people/people.module.js";
import { DayPlanModule } from "./day-plans/day-plan.module.js";
import { AppController } from "./app.controller.js";
import { AuthModule } from "./auth/auth.module.js";
import { CsrfGuard, SessionGuard } from "./auth/guards.js";
import { ChatModule } from "./chat/chat.module.js";
import { CampusEventsModule } from "./campus-events/campus-events.module.js";
import { DatabaseModule } from "./database/database.module.js";
import { ReleaseController } from "./release.controller.js";
import { SchoolModule } from "./school/school.module.js";
import { SpaController } from "./spa.controller.js";
import { PhotoAttendanceModule } from "./photo-attendance/photo-attendance.module.js";
import { OperationsModule } from "./operations/operations.module.js";
import { StaffOperationsModule } from "./staff-operations/staff-operations.module.js";
import { GovernanceModule } from "./governance/governance.module.js";
import { RestrictedCareModule } from "./restricted-care/restricted-care.module.js";
import { InstitutionOnboardingModule } from "./institution-onboarding/institution-onboarding.module.js";
import { InstitutionActivationModule } from "./institution-activation/institution-activation.module.js";
import { AssessmentsModule } from "./assessments/assessments.module.js";
import { AcademicReportsModule } from "./academic-reports/academic-reports.module.js";
import { DepartureCoordinationModule } from "./departure-coordination/departure-coordination.module.js";

@Module({
  imports: [
    TeacherFeedbackModule,
    SchedulePlanningModule,
    CompanyModule,
    PrincipalInsightsModule,
    RolesModule,
    DatabaseModule,
    AuthModule,
    SchoolModule,
    ChatModule,
    AiModule,
    CoordinationModule,
    PeopleModule,
    DayPlanModule,
    PhotoAttendanceModule,
    OperationsModule,
    CampusEventsModule,
    StaffOperationsModule,
    GovernanceModule,
    RestrictedCareModule,
    InstitutionOnboardingModule,
    InstitutionActivationModule,
    AssessmentsModule,
    AcademicReportsModule,
    DepartureCoordinationModule,
  ],
  controllers: [AppController, ReleaseController, SpaController],
  providers: [
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
  ],
})
export class AppModule {}
