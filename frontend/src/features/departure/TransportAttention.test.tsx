import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TransportAttention } from "./TransportAttention";
import { useWorkspaceManifest } from "../workspace/useWorkspaceManifest";
vi.mock("../workspace/useWorkspaceManifest", () => ({ useWorkspaceManifest: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
describe("Transport attention", () => {
  it("exposes exact destinations from the responsibility-composed Work projection", () => {
    vi.mocked(useWorkspaceManifest).mockReturnValue({ data: { work: { items: [
      { id: "1", kind: "task", urgency: "overdue", title: "Walking test", status_label: "Journey did not start", due_label: "10 Oct 2026", action_label: "Review", href: "/areas/departure/manage/journeys/ride-1?focus=reconciliation" },
      { id: "2", kind: "task", urgency: "normal", title: "Unrelated event", action_label: "Review", href: "/areas/events/manage/2" },
    ] } } } as ReturnType<typeof useWorkspaceManifest>);
    render(<MemoryRouter><TransportAttention/></MemoryRouter>);
    expect(screen.getByRole("link", { name: /Walking test/ })).toHaveAttribute("href", "/areas/departure/manage/journeys/ride-1?focus=reconciliation");
    expect(screen.getByText("10 Oct 2026")).toBeVisible();
    expect(screen.queryByText("Unrelated event")).not.toBeInTheDocument();
  });
  it("removes the list when no items remain", () => {
    vi.mocked(useWorkspaceManifest).mockReturnValue({ data: { work: { items: [] } } } as unknown as ReturnType<typeof useWorkspaceManifest>);
    render(<MemoryRouter><TransportAttention/></MemoryRouter>);
    expect(screen.queryByRole("heading", { name: "Needs attention" })).not.toBeInTheDocument();
  });
});
