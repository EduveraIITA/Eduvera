import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth, authDestination } from "./AuthContext";
import {
  ApplicationExecutionEnvironmentProvider,
  EXECUTION_ENVIRONMENT_SIGNAL_KEY,
} from "../simulation/ApplicationExecutionEnvironment";
import { useExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";

const apiFetchMock = vi.hoisted(() => vi.fn());

vi.mock("../../lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/api")>();
  return { ...original, apiFetch: apiFetchMock };
});

const adminUser = {
  id: "admin-1",
  username: "meera.kapoor",
  email: "meera.kapoor@example.test",
  first_name: "Meera",
  last_name: "Kapoor",
  display_name: "Meera Kapoor",
  role: "admin" as const,
  active_school_id: "school-1",
};

function AuthProbe() {
  const auth = useAuth();
  return (
    <div>
      <span data-testid="status">{auth.status}</span>
      <span data-testid="demo-mode">{String(auth.demoMode)}</span>
      <span data-testid="user">{auth.user?.display_name ?? "none"}</span>
      <span data-testid="environment">{auth.executionEnvironment.mode === "live" ? "live" : auth.executionEnvironment.runId}</span>
      <span data-testid="membership-roles">{auth.memberships.map(membership => membership.role).join(",")}</span>
      <button type="button" onClick={() => void auth.login({ identifier: "meera.principal", password: "password" })}>Sign in</button>
      <button type="button" onClick={() => void auth.register({ email: "new@example.test", password: "secure-password" })}>Sign up</button>
      <button type="button" onClick={() => void auth.enterDemo("admin")}>Principal demo</button>
      <button type="button" onClick={() => void auth.logout()}>Sign out</button>
    </div>
  );
}

function renderAuth() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider><AuthProbe /></AuthProvider>
    </QueryClientProvider>,
  );
}

function AuthEnvironmentProbe() {
  const auth = useAuth();
  const environment = useExecutionEnvironment();
  return <div>
    <output data-testid="application-auth-status">{auth.status}</output>
    <output data-testid="application-environment">
      {environment.mode === "live" ? "live" : environment.runId}
    </output>
  </div>;
}

function renderAuthEnvironment() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData(["live-campus-data"], "live");
  const view = render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ApplicationExecutionEnvironmentProvider>
          <AuthEnvironmentProbe />
        </ApplicationExecutionEnvironmentProvider>
      </AuthProvider>
    </QueryClientProvider>,
  );
  return { ...view, queryClient };
}

describe("AuthProvider logout", () => {
  afterEach(cleanup);

  beforeEach(() => {
    window.localStorage.clear();
    apiFetchMock.mockReset();
  });

  it("stays signed out when server-side session cleanup fails", async () => {
    apiFetchMock.mockImplementation((path: string) => {
      if (path === "/api/v1/auth/session/") {
        return Promise.resolve({ authenticated: true, user: adminUser, csrf_token: "csrf", demo_mode: true });
      }
      if (path === "/api/v1/auth/me/") {
        return Promise.resolve({
          user: adminUser,
          students: [],
          memberships: [{ id: "membership-1", school_id: "school-1", school_name: "CIS", role: "admin" }],
          demo_mode: true,
        });
      }
      if (path === "/api/v1/auth/logout/") return Promise.reject(new Error("logout endpoint unavailable"));
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });

    const firstRender = renderAuth();
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("authenticated"));

    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("anonymous"));
    expect(window.localStorage.getItem("omnischool:explicitly-logged-out")).toBe("1");
    expect(window.localStorage.getItem("omnischool:logged-out-demo-mode")).toBe("1");
    expect(apiFetchMock).toHaveBeenCalledWith("/api/v1/auth/logout/", { method: "POST" });

    firstRender.unmount();
    apiFetchMock.mockClear();
    renderAuth();

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("anonymous"));
    expect(screen.getByTestId("demo-mode")).toHaveTextContent("true");
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it("reads the server-owned simulation descriptor from the authenticated profile", async () => {
    const executionEnvironment = {
      mode: "simulation" as const,
      namespace_id: "scenario:run-1",
      run_id: "run-1",
      scenario_id: "scenario-1",
      institution_id: "school-1",
      virtual_clock: { now: "2026-10-19T09:15:00.000+05:30", time_zone: "Asia/Kolkata" },
      source_snapshot_at: "2026-10-17T08:00:00.000Z",
      expires_at: "2026-10-20T08:00:00.000Z",
    };
    apiFetchMock.mockImplementation((path: string) => {
      if (path === "/api/v1/auth/session/") return Promise.resolve({ authenticated: true, user: adminUser, csrf_token: "csrf", demo_mode: true, execution_environment: executionEnvironment });
      if (path === "/api/v1/auth/me/") return Promise.resolve({
        user: adminUser,
        students: [],
        memberships: [{ id: "membership-1", school_id: "school-1", school_name: "CIS", role: "admin" }],
        demo_mode: true,
        execution_environment: executionEnvironment,
      });
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });

    renderAuth();

    await waitFor(() => expect(screen.getByTestId("environment")).toHaveTextContent("run-1"));
  });

  it("preserves simultaneous institution relationships without deriving a portal", async () => {
    apiFetchMock.mockImplementation((path: string) => {
      if (path === "/api/v1/auth/session/") return Promise.resolve({ authenticated: true, user: adminUser, csrf_token: "csrf", demo_mode: false });
      if (path === "/api/v1/auth/me/") return Promise.resolve({
        user: adminUser,
        students: [],
        memberships: [
          { id: "admin-membership", school_id: "school-1", school_name: "CIS", role: "admin" },
          { id: "staff-membership", school_id: "school-1", school_name: "CIS", role: "staff" },
        ],
        school_permissions: [{ school_id: "school-1", role: "admin", permissions: ["attendance.record"], custom_role: null }],
        demo_mode: false,
      });
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });

    renderAuth();

    await waitFor(() => expect(screen.getByTestId("membership-roles")).toHaveTextContent("admin,staff"));
  });

  it("revalidates a cross-tab switch through the real AuthContext refresh contract", async () => {
    const simulationEnvironment = {
      mode: "simulation" as const,
      namespace_id: "scenario:run-2",
      run_id: "run-2",
      scenario_id: "scenario-2",
      institution_id: "school-1",
      virtual_clock: { now: "2026-10-20T10:15:00.000+05:30", time_zone: "Asia/Kolkata" },
      source_snapshot_at: "2026-10-17T08:00:00.000Z",
      expires_at: "2099-10-20T08:00:00.000Z",
    };
    const serverSession = { environment: undefined as typeof simulationEnvironment | undefined };
    apiFetchMock.mockImplementation((path: string) => {
      if (path === "/api/v1/auth/session/") return Promise.resolve({
        authenticated: true,
        user: adminUser,
        csrf_token: "csrf",
        demo_mode: true,
        execution_environment: serverSession.environment,
      });
      if (path === "/api/v1/auth/me/") return Promise.resolve({
        user: adminUser,
        students: [],
        memberships: [{ id: "membership-1", school_id: "school-1", school_name: "CIS", role: "admin" }],
        demo_mode: true,
        execution_environment: serverSession.environment,
      });
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });

    const { queryClient } = renderAuthEnvironment();
    await waitFor(() => expect(screen.getByTestId("application-auth-status")).toHaveTextContent("authenticated"));
    expect(screen.getByTestId("application-environment")).toHaveTextContent("live");

    serverSession.environment = simulationEnvironment;
    window.dispatchEvent(new StorageEvent("storage", {
      key: EXECUTION_ENVIRONMENT_SIGNAL_KEY,
      newValue: JSON.stringify({
        version: 1,
        kind: "session-environment-changed",
        senderId: "another-tab",
        nonce: "refresh-session-on-server",
      }),
    }));

    await waitFor(() => expect(screen.getByTestId("application-environment")).toHaveTextContent("run-2"));
    expect(queryClient.getQueryData(["live-campus-data"])).toBeUndefined();
  });

  it("recovers a transient CSRF bootstrap and signs in after an explicit logout", async () => {
    window.localStorage.setItem("omnischool:explicitly-logged-out", "1");
    let csrfAttempts = 0;
    apiFetchMock.mockImplementation((path: string) => {
      if (path === "/api/v1/auth/csrf/") {
        csrfAttempts += 1;
        return csrfAttempts === 1 ? Promise.reject(new TypeError("proxy restarting")) : Promise.resolve({ csrf_token: "fresh" });
      }
      if (path === "/api/v1/auth/login/") return Promise.resolve({ user: adminUser, csrf_token: "fresh", demo_mode: true });
      if (path === "/api/v1/auth/me/") return Promise.resolve({
        user: adminUser,
        students: [],
        memberships: [{ id: "membership-1", school_id: "school-1", school_name: "CIS", role: "admin" }],
        demo_mode: true,
      });
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });

    renderAuth();
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("anonymous"));
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("authenticated"));
    expect(screen.getByTestId("user")).toHaveTextContent("Meera Kapoor");
    expect(csrfAttempts).toBe(2);
    expect(window.localStorage.getItem("omnischool:explicitly-logged-out")).toBeNull();
  });

  it.each([
    ["Sign up", "/api/v1/auth/register/"],
    ["Principal demo", "/api/v1/auth/demo-session/"],
  ])("establishes a new authenticated session through %s", async (buttonName, endpoint) => {
    window.localStorage.setItem("omnischool:explicitly-logged-out", "1");
    apiFetchMock.mockImplementation((path: string) => {
      if (path === "/api/v1/auth/csrf/") return Promise.resolve({ csrf_token: "fresh" });
      if (path === endpoint) return Promise.resolve({ user: adminUser, csrf_token: "fresh", demo_mode: true });
      if (path === "/api/v1/auth/me/") return Promise.resolve({
        user: adminUser,
        students: [],
        memberships: [{ id: "membership-1", school_id: "school-1", school_name: "CIS", role: "admin" }],
        demo_mode: true,
      });
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });

    renderAuth();
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("anonymous"));
    await userEvent.click(screen.getByRole("button", { name: buttonName }));
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("authenticated"));
    expect(window.localStorage.getItem("omnischool:explicitly-logged-out")).toBeNull();
  });
});

describe("authDestination", () => {
  const membership = (role: "admin" | "staff" | "guardian" | "student" | "member") => ({
    id: `${role}-membership`,
    school_id: "school-1",
    school_name: "CIS",
    role,
    permissions: role === "staff" ? [] : undefined,
  });

  const draftId = "86bca69e-c591-46cb-b04a-ff0895410a75";
  const draftPath = `/areas/timetable/planning?plan=${draftId}&plan_revision=2&date=2026-10-26&section=drafts`;
  function unfinishedTimetable() {
    return {
      status: "authenticated" as const,
      user: { ...adminUser, email_verified: true, active_school_id: "school-1" },
      memberships: [membership("admin")],
      onboarding: {
        status: "ready" as const,
        resume: { step: "first_use" as const, goal: "timetable" as const, path: draftPath,
          continuation: { kind: "activity_plan" as const, actor_user_id: adminUser.id,
            school_id: "school-1", source_id: draftId, source_revision: 2, requires_recheck: true as const } },
      },
    };
  }

  const offeringId = "86bca69e-c591-46cb-b04a-ff0895410a76";
  const assignmentPath = `/areas/messages/assignments?scope=offering&offering_id=${offeringId}&assignment=${draftId}&revision=2`;
  function unfinishedAssignment() {
    const auth = unfinishedTimetable();
    return { ...auth, onboarding: { ...auth.onboarding, resume: {
      ...auth.onboarding.resume, goal: "assignments" as const, path: assignmentPath,
      continuation: { ...auth.onboarding.resume.continuation, kind: "learning_assignment" as const },
    } } };
  }

  it("resumes only a server-vetted own Assignment draft, preserving ordinary entry and source revision recovery", () => {
    const auth = unfinishedAssignment();
    expect(authDestination(auth)).toBe(assignmentPath);
    expect(authDestination(auth, { resumeUnfinishedSetup: false })).toBe("/today");
    expect(authDestination({ ...auth, onboarding: { ...auth.onboarding, resume: { ...auth.onboarding.resume, step: "operating" } } })).toBe("/today");
    auth.onboarding.resume.continuation.source_revision = 3;
    expect(authDestination(auth)).toBe(assignmentPath);
    const classPath = assignmentPath.replace("scope=offering&offering_id=", "scope=class&class_section_id=");
    expect(authDestination({ ...auth, onboarding: { ...auth.onboarding, resume: { ...auth.onboarding.resume, path: classPath } } })).toBe(classPath);
  });

  it.each([
    "/areas/messages/assignments", "//example.test/assignments", "https://example.test/assignments",
    `${assignmentPath}&assignment=${draftId}`, `${assignmentPath}&learner=${offeringId}`, `${assignmentPath}#edit`,
    assignmentPath.replace("scope=offering", "scope=person"), assignmentPath.replace("revision=2", "revision=0"),
    assignmentPath.replace(`assignment=${draftId}`, `assignment=${offeringId}`),
    assignmentPath.replace(`offering_id=${offeringId}`, "offering_id=not-a-uuid"),
  ])("does not authorize or resume an unbound Assignment path %s", path => {
    const auth = unfinishedAssignment(); auth.onboarding.resume.path = path;
    expect(authDestination(auth)).toBe("/today");
  });

  it("keeps Assignment continuation bound to current actor, campus, Live and server provenance", () => {
    const auth = unfinishedAssignment();
    expect(authDestination({ ...auth, user: { ...auth.user, id: "another-account" } })).toBe("/today");
    expect(authDestination({ ...auth, user: { ...auth.user, active_school_id: "school-2" } })).toBe("/today");
    expect(authDestination({ ...auth, executionEnvironment: { mode: "simulation", unavailable: true, unavailableReason: "run_unavailable", namespaceId: "test-world", runId: "test-run" } })).toBe("/today");
    const { step, goal, path } = auth.onboarding.resume;
    expect(authDestination({ ...auth, onboarding: { ...auth.onboarding, resume: { step, goal, path } } })).toBe("/today");
  });

  it("resumes a server-vetted unfinished timetable draft without changing ordinary Today entry", () => {
    expect(authDestination(unfinishedTimetable())).toBe(draftPath);
    expect(authDestination(unfinishedTimetable(), { resumeUnfinishedSetup: false })).toBe("/today");
    const auth = unfinishedTimetable();
    expect(authDestination({ ...auth, onboarding: { ...auth.onboarding, resume: { ...auth.onboarding.resume, step: "operating" } } })).toBe("/today");
  });

  it("keeps a stale but vetted revision as read context for the owning source's recovery", () => {
    const auth = unfinishedTimetable();
    auth.onboarding.resume.continuation.source_revision = 3;
    expect(authDestination(auth)).toBe(draftPath);
  });

  it("ignores unfinished Live continuation inside Simulation", () => {
    expect(authDestination({ ...unfinishedTimetable(), executionEnvironment: {
      mode: "simulation", unavailable: true, unavailableReason: "run_unavailable", namespaceId: "test-world", runId: "test-run",
    } })).toBe("/today");
    expect(authDestination({ ...unfinishedTimetable(), executionEnvironment: {
      mode: "simulation", namespaceId: "test-world", runId: "test-run", virtualClock: { now: "2026-10-23T09:00:00Z", timeZone: "UTC" },
    } })).toBe("/today");
    expect(authDestination({ ...unfinishedTimetable(), executionEnvironment: { mode: "live", institutionId: "school-2" } })).toBe("/today");
  });

  it.each([
    "https://example.test/elsewhere", "//example.test/elsewhere", "/today",
    `/areas/timetable/schedule?plan=${draftId}&plan_revision=2&date=2026-10-26&section=drafts`,
    `${draftPath}&plan=${draftId}`, `${draftPath}&create=activity`, `${draftPath}#edit`,
    draftPath.replace("section=drafts", "section=calendar"),
    draftPath.replace("plan_revision=2", "plan_revision=0"),
    draftPath.replace(`plan=${draftId}`, "plan=not-a-uuid"),
  ])("refuses malformed or mismatched retained draft path %s", path => {
    const auth = unfinishedTimetable(); auth.onboarding.resume.path = path;
    expect(authDestination(auth)).toBe("/today");
  });

  it("refuses another actor, campus or missing server-vetting provenance", () => {
    const actor = unfinishedTimetable(); actor.onboarding.resume.continuation.actor_user_id = "another-account";
    expect(authDestination(actor)).toBe("/today");
    const campus = unfinishedTimetable(); campus.onboarding.resume.continuation.school_id = "school-2";
    expect(authDestination(campus)).toBe("/today");
    const unvetted = unfinishedTimetable();
    const { step, goal, path } = unvetted.onboarding.resume;
    const resume = { step, goal, path };
    expect(authDestination({ ...unvetted, onboarding: { ...unvetted.onboarding, resume } })).toBe("/today");
  });

  it.each(["admin", "staff", "guardian", "student", "member"] as const)(
    "lands a verified %s relationship in the same neutral Today shell",
    (role) => {
      expect(authDestination({
        status: "authenticated",
        user: { ...adminUser, email_verified: true },
        onboarding: {
          status: "ready",
          resume: { step: "operating", goal: "gate", path: "/gate?entry=main" },
        },
        memberships: [membership(role)],
      })).toBe("/today");
    },
  );

  it("keeps account verification ahead of workspace selection", () => {
    expect(authDestination({
      status: "authenticated",
      user: { ...adminUser, email_verified: false },
      memberships: [membership("admin")],
    })).toBe("/account/security");
  });

  it.each(["workspace_required", "purpose_required"] as const)(
    "continues %s onboarding before entering Today",
    (status) => {
      expect(authDestination({
        status: "authenticated",
        user: { ...adminUser, email_verified: true },
        onboarding: { status },
        memberships: [membership("admin")],
      })).toBe("/onboarding/start");
    },
  );

  it("starts onboarding when no institution relationship exists", () => {
    expect(authDestination({
      status: "authenticated",
      user: { ...adminUser, email_verified: true },
      memberships: [],
    })).toBe("/onboarding/start");
  });

  it("keeps company operations outside institution navigation", () => {
    expect(authDestination({
      status: "authenticated",
      user: { ...adminUser, email_verified: true },
      companyOperator: true,
      memberships: [membership("admin")],
    })).toBe("/company");
  });

  it("sends anonymous sessions to login", () => {
    expect(authDestination({ status: "anonymous", memberships: [] })).toBe("/login");
  });
});
