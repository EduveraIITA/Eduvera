import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { AuthenticatedOnly, RoleLanding, WorkspaceOnly } from "./RouteGuards";

const authState = vi.hoisted<{ current: Record<string, unknown> }>(() => ({ current: {} }));

vi.mock("./AuthContext", async (importOriginal) => {
  const original = await importOriginal<typeof import("./AuthContext")>();
  return { ...original, useAuth: () => authState.current };
});

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}</output>;
}

function show(
  Guard: typeof AuthenticatedOnly | typeof WorkspaceOnly,
  path = "/secure?tab=activity",
) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/secure"
          element={<Guard><div>Protected workspace</div></Guard>}
        />
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("relationship-neutral route guards", () => {
  afterEach(cleanup);

  beforeEach(() => {
    authState.current = {
      status: "authenticated",
      user: { id: "person-1", email_verified: true },
      memberships: [],
      companyOperator: false,
    };
  });

  it("requires authentication without choosing a persona portal", () => {
    authState.current = { status: "anonymous", memberships: [] };
    show(AuthenticatedOnly);

    expect(screen.getByTestId("location")).toHaveTextContent(
      "/login?next=%2Fsecure%3Ftab%3Dactivity",
    );
  });

  it("keeps email verification ahead of institution work", () => {
    authState.current = {
      status: "authenticated",
      user: { id: "person-1", email_verified: false },
      memberships: [{ id: "membership-1", role: "staff" }],
    };
    show(WorkspaceOnly);

    expect(screen.getByTestId("location")).toHaveTextContent(
      "/account/security?from=%2Fsecure%3Ftab%3Dactivity",
    );
  });

  it.each(["admin", "staff", "guardian", "student", "member"])(
    "allows a verified %s relationship without inferring domain authority",
    (role) => {
      authState.current = {
        status: "authenticated",
        user: { id: "person-1", email_verified: true },
        memberships: [{
          id: "membership-1",
          school_id: "school-1",
          school_name: "CIS",
          role,
          permissions: [],
        }],
      };
      show(WorkspaceOnly);

      expect(screen.getByText("Protected workspace")).toBeInTheDocument();
    },
  );

  it("sends a verified account with no institution relationship to onboarding", () => {
    show(WorkspaceOnly);

    expect(screen.getByTestId("location")).toHaveTextContent("/onboarding/start");
  });

  it("prioritizes an exact visitor request on the neutral home without losing it to unfinished setup", () => {
    const sourceId = "86bca69e-c591-46cb-b04a-ff0895410a75", visitorId = "7135d0f8-20a5-4964-b899-e6fa8a9ff7c1";
    authState.current = { status: "authenticated", user: { id: "owner", email_verified: true, active_school_id: "campus" },
      memberships: [{ school_id: "campus", role: "admin" }], onboarding: { status: "ready", resume: {
        step: "first_use", goal: "timetable", path: `/areas/timetable/planning?plan=${sourceId}&plan_revision=2&date=2026-10-26&section=drafts`,
        continuation: { kind: "activity_plan", actor_user_id: "owner", school_id: "campus", source_id: sourceId, source_revision: 2, requires_recheck: true },
      } } };
    render(<MemoryRouter initialEntries={[`/?visitor_request=${visitorId}`]}><Routes>
      <Route path="/" element={<RoleLanding />} /><Route path="*" element={<LocationProbe />} />
    </Routes></MemoryRouter>);
    expect(screen.getByTestId("location")).toHaveTextContent(`/today?visitor_request=${visitorId}`);
    expect(screen.getByTestId("location")).not.toHaveTextContent("plan=");
  });
});
