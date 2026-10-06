import type { LucideIcon } from "lucide-react";
import {
  Award, BookOpen, Bot, Bus, CalendarCheck2, CalendarDays, CalendarRange, CalendarX2, ClipboardCheck, FileSpreadsheet,
  FileText, Handshake, MessageCircle, ReceiptIndianRupee, Rocket, Scale, Settings2, ShieldAlert, ShieldCheck, UserRoundCheck, Users, UsersRound,
} from "lucide-react";
import type { Portal } from "../auth/AuthContext";

export type ToolTone = "blue" | "teal" | "violet" | "amber" | "rose" | "slate";

export interface Tool {
  id: string;
  name: string;
  description: string;
  icon: LucideIcon;
  tone: ToolTone;
  /** Mobile route. Absent means the tool is not on mobile yet. */
  path?: string;
  /** Where the tool currently lives when it is not on mobile. */
  planned?: "desktop" | "roadmap";
}

/* Every tool a role can reach from More. The bottom nav carries the daily five;
   this is everything else, plus what is still desktop-only so people know
   where it will land. Order = how often a person reaches for it. */
const TOOLS: Record<Portal, Tool[]> = {
  parent: [
    { id: "departure", name: "Departure & bus", description: "Today's pickup plan, change requests and live school-bus journey", icon: Bus, tone: "blue", path: "/parent/departure" },
    { id: "results", name: "Results", description: "Moderated assessment results released by the institution", icon: Award, tone: "blue", path: "/parent/results" },
    { id: "calendar", name: "Calendar", description: "Month at a glance: attendance, approved leave and each day's periods", icon: CalendarRange, tone: "blue", path: "/parent/calendar" },
    { id: "timetable", name: "Timetable", description: "Your child's published periods and teachers", icon: CalendarDays, tone: "blue", path: "/parent/timetable" },
    { id: "leave", name: "Leave", description: "Authorise requests and apply for planned leave", icon: CalendarX2, tone: "violet", path: "/parent/leave" },
    { id: "diary", name: "Diary", description: "Homework, notes and announcements from teachers", icon: BookOpen, tone: "rose", path: "/parent/diary" },
    { id: "events", name: "Events & activities", description: "Invitations, consent and preparation for your children", icon: CalendarDays, tone: "teal", path: "/parent/events" },
    { id: "messages", name: "Messages", description: "Homeroom and school office conversations", icon: MessageCircle, tone: "teal", path: "/parent/messages" },
    { id: "fees", name: "Fees & receipts", description: "Invoices, receipts and outstanding balance", icon: ReceiptIndianRupee, tone: "amber", path: "/parent/fees" },
    { id: "policies", name: "Policies", description: "Published school policies and acknowledgements", icon: Scale, tone: "slate", path: "/parent/policies" },
    { id: "security", name: "Account security", description: "Verified email, authenticator and password recovery", icon: ShieldCheck, tone: "slate", path: "/account/security" },
  ],
  student: [
    { id: "results", name: "Results", description: "Your published assessment results and feedback", icon: Award, tone: "blue", path: "/student/results" },
    { id: "calendar", name: "Calendar", description: "Your month: school days, leave and each day's periods", icon: CalendarRange, tone: "blue", path: "/student/calendar" },
    { id: "attendance", name: "Attendance", description: "Live aggregate, subject quotas and eligibility", icon: CalendarCheck2, tone: "teal", path: "/student/attendance" },
    { id: "copilot", name: "Attendance Copilot", description: "Ask policy and projection questions using your own data", icon: Bot, tone: "violet", path: "/student/copilot" },
    { id: "leave", name: "Leave", description: "Apply for leave and track approval", icon: CalendarX2, tone: "rose", path: "/student/leave" },
    { id: "diary", name: "Diary", description: "Homework, teacher notes and announcements", icon: BookOpen, tone: "amber", path: "/student/diary" },
    { id: "messages", name: "Messages", description: "School and teacher conversations", icon: MessageCircle, tone: "teal", path: "/student/messages" },
    { id: "fees", name: "Fees", description: "Invoices, receipts and payment history", icon: ReceiptIndianRupee, tone: "amber", path: "/student/fees" },
    { id: "policies", name: "Policies", description: "Published institution policies for students", icon: Scale, tone: "slate", path: "/student/policies" },
    { id: "security", name: "Account security", description: "Verified email, authenticator and password recovery", icon: ShieldCheck, tone: "slate", path: "/account/security" },
  ],
  teacher: [
    { id: "transport", name: "Transport journey", description: "Operate an assigned route, rider roster and journey location", icon: Bus, tone: "blue", path: "/teacher/transport" },
    { id: "assessments", name: "Assessments & marking", description: "Assigned offline assessments, marks and moderation", icon: Award, tone: "blue", path: "/teacher/assessments" },
    { id: "report-cards", name: "Report remarks", description: "Review class reports and add assigned remarks", icon: FileText, tone: "blue", path: "/teacher/report-cards" },
    { id: "responsibilities", name: "My responsibilities", description: "Class, event and cover duties with clear dates and scope", icon: Handshake, tone: "blue", path: "/teacher/responsibilities" },
    { id: "leave", name: "My leave", description: "Balances, applications and approval history", icon: CalendarX2, tone: "rose", path: "/teacher/leave" },
    { id: "classes", name: "My classes", description: "Every class you teach, today's register status and the live roster", icon: Users, tone: "blue", path: "/teacher/classes" },
    { id: "calendar", name: "Calendar", description: "Month view of teaching days, periods and registers", icon: CalendarRange, tone: "teal", path: "/teacher/calendar" },
    { id: "weekly", name: "Weekly timetable", description: "Your published schedule, day by day", icon: CalendarDays, tone: "violet", path: "/teacher/timetable/weekly" },
    { id: "registers", name: "Registers", description: "Take and review attendance for your lessons", icon: ClipboardCheck, tone: "amber", path: "/teacher/attendance" },
    { id: "messages", name: "Messages", description: "School and family conversations", icon: MessageCircle, tone: "teal", path: "/teacher/messages" },
    { id: "events", name: "Events & class tests", description: "Plan class tests and activities, review responses and take event attendance", icon: CalendarDays, tone: "teal", path: "/teacher/events" },
    { id: "safeguarding", name: "Safeguarding", description: "Report and review welfare concerns", icon: ShieldAlert, tone: "rose", path: "/teacher/safeguarding" },
    { id: "policies", name: "Policies", description: "Staff policies, review dates and acknowledgements", icon: Scale, tone: "slate", path: "/teacher/policies" },
    { id: "security", name: "Account security", description: "Verified email, authenticator and password recovery", icon: ShieldCheck, tone: "slate", path: "/account/security" },
  ],
  principal: [
    { id: "departure", name: "Departure & transport", description: "Pickup authority, daily plans, routes, rosters and gate handover", icon: Bus, tone: "blue", path: "/principal/departure" },
    { id: "assessments", name: "Assessments & results", description: "Schedule offline assessments, moderate marks and publish results", icon: Award, tone: "blue", path: "/principal/assessments" },
    { id: "report-cards", name: "Grading & report cards", description: "Configure grading, review calculations and publish term reports", icon: FileText, tone: "blue", path: "/principal/report-cards" },
    { id: "activation", name: "Institution setup", description: "Complete, review and activate first-day readiness", icon: Rocket, tone: "blue", path: "/principal/activation" },
    {id: "roles", name: "Roles & permissions", description: "Create custom roles and assign staff access", icon: ShieldCheck, tone: "blue", path: "/principal/roles"},
    { id: "staff", name: "Staff operations", description: "Onboarding, scoped responsibilities, leave and cover", icon: UserRoundCheck, tone: "teal", path: "/principal/staff" },
    { id: "governance", name: "Policies & compliance", description: "Institution profile, policy lifecycle and acknowledgements", icon: Scale, tone: "blue", path: "/principal/governance" },
    { id: "calendar", name: "Calendar", description: "Month view of school days, coverage and registers", icon: CalendarRange, tone: "blue", path: "/principal/calendar" },
    { id: "people", name: "Students & guardians", description: "Directory, enrolment and guardian authority", icon: UsersRound, tone: "teal", path: "/principal/students" },
    { id: "events", name: "Events & activities", description: "Publish school activities, manage consent and event attendance", icon: CalendarDays, tone: "blue", path: "/principal/events" },
    { id: "import", name: "Import students", description: "Bulk enrol from a spreadsheet with review before commit", icon: FileSpreadsheet, tone: "amber", path: "/principal/students/import" },
    { id: "weekly", name: "Manage timetable", description: "Weekly plan, subject targets and school dates", icon: CalendarDays, tone: "violet", path: "/principal/timetable/weekly" },
    { id: "messages", name: "Messages", description: "School and family conversations", icon: MessageCircle, tone: "teal", path: "/principal/messages" },
    { id: "safeguarding", name: "Safeguarding", description: "Moderation queue and welfare reports", icon: ShieldAlert, tone: "rose", path: "/principal/safeguarding" },
    { id: "administration", name: "School administration", description: "Terms, classes, invitations and school access", icon: Settings2, tone: "slate", path: "/principal/administration" },
    { id: "fees", name: "Fee ledger", description: "Post invoices and record offline receipts", icon: ReceiptIndianRupee, tone: "amber", path: "/principal/fees" },
    { id: "security", name: "Account security", description: "Verified email, authenticator and password recovery", icon: ShieldCheck, tone: "slate", path: "/account/security" },
  ],
};

export const moreRoute: Record<Portal, string> = { parent: "/parent/more", student: "/student/apps", teacher: "/teacher/more", principal: "/principal/more" };

export function toolsFor(portal: Portal): Tool[] {
  return TOOLS[portal];
}
