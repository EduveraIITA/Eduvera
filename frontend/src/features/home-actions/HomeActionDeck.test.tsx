import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { HomeActionDeck } from "./HomeActionDeck";
import type { HomeAction } from "./types";

const action: HomeAction = {
  id: "event-rsvp:event-1",
  kind: "event_rsvp",
  priority: "high",
  title: "Respond to Science Museum Visit",
  detail: "Accept or decline the invitation so the school can plan the participant roster.",
  status_label: "RSVP pending",
  action_label: "Respond now",
  href: "/parent/events/event-1?student_id=student-1",
  source_id: "event-1",
  occurs_at: "2026-10-08T03:30:00.000Z",
  due_at: "2026-10-08T03:30:00.000Z",
};

describe("HomeActionDeck", () => {
  it("does not render an empty action module", () => {
    const { container } = render(<MemoryRouter><HomeActionDeck actions={[]} /></MemoryRouter>);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the next action with one clear destination", () => {
    render(<MemoryRouter><HomeActionDeck actions={[action]} title="What needs you" /></MemoryRouter>);
    expect(screen.getByRole("heading", { name: "What needs you" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Respond to Science Museum Visit/i })).toHaveAttribute(
      "href",
      "/parent/events/event-1?student_id=student-1",
    );
    expect(screen.getByText("RSVP pending")).toBeInTheDocument();
  });

  it("uses an in-page destination for an attendance follow-up", () => {
    render(<MemoryRouter><HomeActionDeck actions={[{ ...action, id: "attendance-followup:1", kind: "attendance_followup", href: "#attendance-followups", action_label: "Reply" }]} /></MemoryRouter>);
    expect(screen.getByRole("link", { name: /Reply/i })).toHaveAttribute("href", "#attendance-followups");
  });
});
