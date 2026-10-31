import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OperationsShell } from "./OperationsShell";
const state = vi.hoisted(() => ({ role: "staff", independent: false }));
vi.mock("../../features/auth/AuthContext", () => ({ useOptionalAuth: () => ({ user: { id: "technician", role: state.role, active_school_id: "current" }, memberships: [{ role: "member", school_id: "current", school_name: "Campus", access_scope: "assigned_work" }, ...(state.independent ? [{ role: "staff", school_id: "current", school_name: "Campus", access_scope: "campus" }] : [])] }) }));
vi.mock("../../features/auth/useProFeatures", () => ({ useProFeatures: () => ({ enabled: true }) }));
vi.mock("../../features/auth/AccountMenu", () => ({ AccountMenu: () => null }));
vi.mock("../../features/notifications/NotificationCenter", () => ({ NotificationCenter: () => null }));
vi.mock("../../features/simulation/SimulationSessionControls", () => ({ SimulationSessionControls: () => null }));
vi.mock("../../features/assistant/useDemoChat", () => ({ useDemoChat: () => ({ active: false, open: false, fullPage: false }) }));
vi.mock("../../features/assistant/DemoChat", () => ({ AssistantTab: () => <button>Assistant</button>, AssistantPanel: () => <p>Assistant panel</p> }));
afterEach(cleanup);
beforeEach(() => { state.role = "staff"; state.independent = false; });
function mount() { render(<MemoryRouter initialEntries={["/areas/facilities"]}><OperationsShell portal="principal" active="areas" title="Repairs">Assigned repair</OperationsShell></MemoryRouter>); }
describe("the shared shell honors source-only app access", () => {
  it.each(["staff", "admin", "student"])("does not show the assistant for a global %s account or an explicit legacy portal prop", role => {
    state.role = role; mount(); expect(screen.queryByRole("button", { name: "Assistant" })).not.toBeInTheDocument(); expect(screen.queryByText("Assistant panel")).not.toBeInTheDocument();
    expect(screen.getByText("Assigned repair")).toBeVisible(); expect(screen.getAllByRole("link", { name: "Work", hidden: true })).toHaveLength(2);
  });
  it("retains the assistant when the same campus has an independent campus membership", () => {
    state.independent = true; mount(); expect(screen.getAllByRole("button", { name: "Assistant", hidden: true })).toHaveLength(2); expect(screen.getByText("Assistant panel")).toBeVisible();
  });
});
