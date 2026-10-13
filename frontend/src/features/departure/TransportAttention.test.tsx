import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TransportAttention } from "./TransportAttention";
import { useAttention } from "../attention/useAttention";
vi.mock("../attention/useAttention", () => ({ useAttention: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
describe("Transport attention", () => {
  it("exposes dated exact destinations from the same source as the menu badge", () => {
    vi.mocked(useAttention).mockReturnValue({ data: { items: [
      { id: "1", module: "departure", title: "Walking test", status_label: "Journey did not start", due_at: "2026-10-10T09:00:00Z", href: "/principal/departure/journeys/ride-1?focus=reconciliation" },
      { id: "2", module: "events", title: "Unrelated event", href: "/events/2" },
    ] } } as ReturnType<typeof useAttention>);
    render(<MemoryRouter><TransportAttention/></MemoryRouter>);
    expect(screen.getByRole("link", { name: /Walking test/ })).toHaveAttribute("href", "/principal/departure/journeys/ride-1?focus=reconciliation");
    expect(screen.getByText("10 Oct 2026")).toBeVisible();
    expect(screen.queryByText("Unrelated event")).not.toBeInTheDocument();
  });
  it("removes the list when no items remain", () => {
    vi.mocked(useAttention).mockReturnValue({ data: { items: [] } } as unknown as ReturnType<typeof useAttention>);
    render(<MemoryRouter><TransportAttention/></MemoryRouter>);
    expect(screen.queryByRole("heading", { name: "Needs attention" })).not.toBeInTheDocument();
  });
});
