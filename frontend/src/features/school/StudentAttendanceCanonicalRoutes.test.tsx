import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { StudentCopilotRoute, StudentEligibilityRoute } from "./StudentLiveRoutes";

function Destination() {
  const location = useLocation();
  return <output aria-label="destination">{`${location.pathname}${location.search}${location.hash}`}</output>;
}

function show(path: string, element: ReactNode) {
  return render(<MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route path="*" element={element} />
      <Route path="/areas/attendance/records" element={<Destination />} />
    </Routes>
  </MemoryRouter>);
}

afterEach(cleanup);

describe("student Attendance bookmark convergence", () => {
  it("moves the eligibility bookmark into the canonical Attendance surface without losing context", async () => {
    show("/student/attendance/eligibility?term=term-1#documents", <StudentEligibilityRoute />);
    expect(await screen.findByLabelText("destination")).toHaveTextContent(
      "/areas/attendance/records?term=term-1&scope=self&view=eligibility#documents",
    );
  });

  it("moves the Copilot bookmark into the same canonical Attendance surface", async () => {
    show("/student/copilot?question=absence#ask", <StudentCopilotRoute />);
    expect(await screen.findByLabelText("destination")).toHaveTextContent(
      "/areas/attendance/records?question=absence&scope=self&view=copilot#ask",
    );
  });
});
