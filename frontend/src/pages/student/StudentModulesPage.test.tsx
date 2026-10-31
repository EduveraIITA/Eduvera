import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { StudentModulesPage } from "./StudentModulesPage";
import { WorkspaceAreaRoutePage } from "../../features/workspace/WorkspaceAreaRoutePage";
import { ExecutionEnvironmentProvider } from "../../features/simulation/ExecutionEnvironmentContext";
import { getWorkspaceManifest } from "../../features/workspace/api";

vi.mock("../../features/workspace/api", () => ({ getWorkspaceManifest: vi.fn() }));
vi.mock("../operations/OperationsShell", () => ({ OperationsShell: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
afterEach(() => { cleanup();vi.clearAllMocks(); });

function NavigationProbe() {
  const location = useLocation();const navigate = useNavigate();
  return <><output aria-label="Current route">{location.pathname}{location.search}</output><button type="button" onClick={() => navigate(-1)}>Back</button></>;
}

it("replaces the old student catalogue bookmark with the shared More destination", async () => {
  render(<MemoryRouter initialEntries={["/today", "/student/apps"]}><Routes>
    <Route path="/student/apps" element={<StudentModulesPage />} />
    <Route path="/more" element={<h1>More</h1>} />
    <Route path="/today" element={<h1>Today</h1>} />
  </Routes><NavigationProbe /></MemoryRouter>);
  expect(await screen.findByRole("heading", { name: "More" })).toBeVisible();
  expect(screen.getByLabelText("Current route")).toHaveTextContent("/more");
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(await screen.findByRole("heading", { name: "Today" })).toBeVisible();
});

it("opens published results through the exact self-learner surface in the canonical Assessments Area", async () => {
  vi.mocked(getWorkspaceManifest).mockResolvedValue({
    revision: "1", generated_at: "2026-10-19T08:00:00Z",
    context: { institution_id: "school", environment: { kind: "live" } },
    today: { now: [], next: [], attention: { total: 0, overdue: 0, due_soon: 0 } }, work: { total: 0, items: [] },
    areas: [{ key: "assessments", label: "Assessments", href: "/areas/assessments", capabilities: ["assessments.view"], scopes: [{ kind: "self", id: "learner-1" }], surfaces: [{ key: "results:self:learner-1", label: "My results", href: "/areas/assessments/results?scope=self&student_id=learner-1", capabilities: ["assessments.view"], scopes: [{ kind: "self", id: "learner-1" }] }] }],
    more: { setup: [] }, freshness: { state: "current", as_of: "Now", source_revision: "1" },
  });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ExecutionEnvironmentProvider environment={{ mode: "live", namespaceId: "live:school" }}><MemoryRouter initialEntries={["/areas/assessments"]}><Routes>
    <Route path="/areas/assessments" element={<WorkspaceAreaRoutePage areaKey="assessments" />} />
    <Route path="/areas/assessments/results" element={<h1>Student results opened</h1>} />
  </Routes><NavigationProbe /></MemoryRouter></ExecutionEnvironmentProvider></QueryClientProvider>);
  expect(await screen.findByRole("heading", { name: "Student results opened" })).toBeVisible();
  await waitFor(() => expect(screen.getByLabelText("Current route")).toHaveTextContent("/areas/assessments/results?scope=self&student_id=learner-1"));
});
