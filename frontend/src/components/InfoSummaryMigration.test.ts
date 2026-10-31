import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// An explicit semantic inventory: informational help uses i; a form, action,
// history/record list or navigation disclosure keeps its expand/collapse cue.
const migrated: Array<[string, string[]]> = [
  ["analytics/AnalyticsPage.tsx", ["How attendance is counted", "How scores are counted"]],
  ["analytics/InstitutionAnalytics.tsx", ["How enrolment is counted", "How staff are counted", "How registers are counted"]],
  ["principal-insights/AttendanceReview.tsx", ["Why these students?", "Evidence used"]],
  ["assistant/AgentChart.tsx", ["Data and method"]],
  ["assistant/AgentReply.tsx", ["Action receipt", "Source checked"]],
  ["activities/ActivityRegisterHistory.tsx", ["Original record"]],
  ["activities/ActivityPlanEditor.tsx", ["Setup details", "Before publishing"]],
  ["activities/ActivityPlaceQuickCreate.tsx", ["Place details"]],
  ["workspace/WorkspacePrimitives.tsx", ["Schedule details"]],
  ["attendance/ResponsibilityAttendanceWorkspace.tsx", ["Access details"]],
  ["calendar/CalendarView.tsx", ["Calendar key"]],
  ["campus-view/CampusScenarioResult.tsx", ["Assumptions and limits"]],
  ["simulation/SimulationResourcePauseNotice.tsx", ["Pause details"]],
  ["simulation/SimulationWorkspacePage.tsx", ["How Simulation protects Live"]],
  ["simulation/ActiveSimulationWorkspace.tsx", ["Not modelled in this run", "Live remains unchanged"]],
  ["people/PeopleParticipantsPage.tsx", ["Dates and published plans"]],
  ["onboarding/OrganizationVerificationPage.tsx", ["About verification"]],
  ["auth/CampusLoginLayout.tsx", ["Help"]],
  ["onboarding/StartingPoints.tsx", ["What’s included"]],
  ["onboarding/ProgressiveSetupPage.tsx", ["Visitor records"]],
];

const preserved: Array<[string, string[]]> = [
  ["activities/ActivityPlanEditor.tsx", ["Activity lead (optional)", "Academic context, if applicable", "Timezone & notes"]],
  ["onboarding/OrganizationVerificationPage.tsx", ["Website (optional)"]],
  ["onboarding/JoinPage.tsx", ["Invitation details"]],
  ["auth/AccountSecurityPages.tsx", ["Reset link details"]],
  ["onboarding/ProgressiveSetupPage.tsx", ["More campus options"]],
  ["people/PeopleParticipantsPage.tsx", ["More actions"]],
  ["appearance/AppearanceMenu.tsx", ["Appearance"]],
  ["chat/ChatPage.tsx", ["Conversation options"]],
  ["people/PersonProfilePage.tsx", ["Connection history"]],
  ["people/PeopleGroupDetailPage.tsx", ["Containment history", "Membership history"]],
  ["activities/ActivityPlanDetail.tsx", ["Scheduled changes"]],
  ["activities/ActivityRegisterHistory.tsx", ["View evidence"]],
  ["staff-operations/StaffRoleAssignments.tsx", ["Allowed actions", "End this assignment", "Past assignments"]],
  ["analytics/AnalyticsPage.tsx", ["View chart data"]],
  ["onboarding/StartingPoints.tsx", ["Add anytime"]],
];

const source = (file: string) => readFileSync(join(process.cwd(), "src/features", file), "utf8").replaceAll("&amp;", "&");

describe("informative help versus expandable work", () => {
  it.each(migrated)("uses the shared information marker in %s", (file, labels) => {
    const text = source(file);
    const summaries = text.match(/<InfoSummary\b[\s\S]*?<\/InfoSummary>/g) ?? [];
    for (const label of labels) expect(summaries.some(summary => summary.includes(label)), label).toBe(true);
  });

  it.each(preserved)("keeps form, record and navigation disclosures in %s", (file, labels) => {
    const summaries = source(file).match(/<summary\b[\s\S]*?<\/summary>/g) ?? [];
    for (const label of labels) expect(summaries.some(summary => summary.includes(label)), label).toBe(true);
  });
});
