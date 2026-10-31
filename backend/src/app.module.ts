import { GateModule } from "./gate/gate.module.js";
import { OrganizationModule } from "./organization/organization.module.js";
import { TeacherFeedbackModule } from "./teacher-feedback/teacher-feedback.module.js";
import { OperatingRulesModule } from "./operating-rules/operating-rules.module.js";
import { InvitationEmailWorker } from "./common/invitation-queue.js";
import { CompanyModule } from "./company/company.module.js";
import { AnalyticsModule } from "./analytics/analytics.module.js";
import { PrincipalInsightsModule } from "./principal-insights/principal-insights.module.js";
import { SchedulePlanningModule } from "./schedule-planning/schedule-planning.module.js";
import { RolesModule } from "./roles/roles.module.js";
import { PermissionGuard } from "./roles/permission.guard.js";
import { Module } from "@nestjs/common";
import { APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { AiModule } from "./ai/ai.module.js";
import { AgentModule } from "./agent/agent.module.js";
import { CoordinationModule } from "./coordination/coordination.module.js";
import { PeopleModule } from "./people/people.module.js";
import { DayPlanModule } from "./day-plans/day-plan.module.js";
import { AppController } from "./app.controller.js";
import { AuthModule } from "./auth/auth.module.js";
import { CsrfGuard, PublicDemoGuard, SessionGuard } from "./auth/guards.js";
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
import { InstitutionSetupModule } from "./institution-setup/institution-setup.module.js";
import { AssessmentsModule } from "./assessments/assessments.module.js";
import { AcademicReportsModule } from "./academic-reports/academic-reports.module.js";
import { DepartureCoordinationModule } from "./departure-coordination/departure-coordination.module.js";
import { RequestsModule } from "./requests/requests.module.js";
import { NoticesModule } from "./notices/notices.module.js";
import { AttentionModule } from "./attention/attention.module.js";
import { AttendanceModelModule } from "./attendance-model/attendance-model.module.js";
import { ActivityAttendanceModule } from "./attendance/activity-attendance.module.js";
import { AgentChannelModule } from "./agent/channels/channel.module.js";
import { CalendarIntegrationsModule } from "./calendar-integrations/calendar-integrations.module.js";
import { CampusViewModule } from "./campus-view/campus-view.module.js";
import { CampusScenesModule } from "./campus-scenes/campus-scenes.module.js";
import { CampusSceneImportModule } from "./campus-scene-import/scene-import.module.js";
import { CampusScenarioModule } from "./campus-scenarios/campus-scenario.module.js";
import { ExecutionEnvironmentInterceptor } from "./auth/execution-environment.interceptor.js";
import { AssignedWorkAccess } from './auth/assigned-work-access.js';
import { OperatingDayModule } from "./operating-day/operating-day.module.js";
import { WorkspaceModule } from "./workspace/workspace.module.js";
import { SimulationModule } from "./simulation/simulation.module.js";
import { LearningAssignmentsModule } from "./learning/learning-assignments.module.js";
import { TeachingSessionsModule } from "./teaching-sessions/teaching-sessions.module.js";
import { FinanceArrangementsModule } from "./operations/finance-arrangements.module.js";
import { NativeFeeReviewsModule } from "./operations/native-fee-reviews.module.js";
import { ResourceLoansModule } from "./resource-loans/resource-loans.module.js";
import { FacilitiesModule } from "./facilities/facilities.module.js";
import { AccommodationModule } from "./facilities/accommodation/accommodation.module.js";
import { DiningModule } from "./dining/dining.module.js";
import { CampusDatesModule } from "./campus-dates/campus-dates.module.js";

@Module({
  imports: [
    GateModule,
    OrganizationModule,
    OperatingRulesModule,
    TeacherFeedbackModule,
    AnalyticsModule,
    SchedulePlanningModule,
    CompanyModule,
    PrincipalInsightsModule,
    RolesModule,
    DatabaseModule,
    AuthModule,
    SchoolModule,
    LearningAssignmentsModule,
    TeachingSessionsModule,
    FinanceArrangementsModule,
    NativeFeeReviewsModule,
    ResourceLoansModule,
    FacilitiesModule,
    AccommodationModule,
    DiningModule,
    CampusDatesModule,
    ChatModule,
    AiModule,
    AgentModule,
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
    InstitutionSetupModule,
    AssessmentsModule,
    AcademicReportsModule,
    DepartureCoordinationModule,
    RequestsModule,
    NoticesModule,
    AttentionModule,
    AttendanceModelModule,
    ActivityAttendanceModule,
    AgentChannelModule,
    CalendarIntegrationsModule,
    CampusViewModule,
    CampusScenesModule,
    CampusSceneImportModule,
    CampusScenarioModule,
    SimulationModule,
    OperatingDayModule,
    WorkspaceModule,
  ],
  controllers: [AppController, ReleaseController, SpaController],
  providers: [
    InvitationEmailWorker,
    AssignedWorkAccess,
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: PublicDemoGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
    { provide: APP_INTERCEPTOR, useClass: ExecutionEnvironmentInterceptor },
  ],
})
export class AppModule {}
