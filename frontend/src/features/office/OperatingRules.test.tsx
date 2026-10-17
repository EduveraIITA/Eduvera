import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { OperatingRules } from "./OperatingRules";

describe("Operating rules index", () => {
  it("offers institution-scoped categories without loading transaction editors", () => {
    render(<MemoryRouter initialEntries={["/principal/administration?section=rules"]}><OperatingRules schoolId="school-one"/></MemoryRouter>);
    for (const [name, rule] of [["Examination day", "examinations"], ["Event attendance", "events"], ["Leave cover", "coverage"], ["Departure & transport", "departure"], ["Messaging", "messages"]]) {
      expect(screen.getByRole("link", { name: new RegExp(name) })).toHaveAttribute("href", `/principal/administration?school=school-one&section=rules&rule=${rule}`);
    }
    expect(screen.queryByRole("button", { name: /save/i })).not.toBeInTheDocument();
    for (const link of screen.getAllByRole("link")) {
      expect(link).toHaveClass("more-tile--text-only");
      expect(link.querySelector(".more-tile__chevron")).not.toBeNull();
    }
  });
});
