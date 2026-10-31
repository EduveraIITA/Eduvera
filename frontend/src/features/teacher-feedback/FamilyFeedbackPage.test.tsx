import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import FamilyFeedbackPage from "./FamilyFeedbackPage";
import PrincipalFeedbackPage from "./PrincipalFeedbackPage";

function Destination() {
  const location = useLocation();
  return <p>{`${location.pathname}${location.search}${location.hash}`}</p>;
}

afterEach(cleanup);

describe("legacy teacher feedback bookmarks", () => {
  it("redirects dependent feedback with campaign and fragment intact", async () => {
    render(<MemoryRouter initialEntries={["/parent/teacher-feedback?campaign=campaign-2#response"]}>
      <Routes>
        <Route path="/parent/teacher-feedback" element={<FamilyFeedbackPage portal="parent" />} />
        <Route path="/more/feedback" element={<Destination />} />
      </Routes>
    </MemoryRouter>);

    expect(await screen.findByText("/more/feedback?campaign=campaign-2&scope=dependent&view=respond#response")).toBeVisible();
  });

  it("redirects coordination without mounting the former principal presentation", async () => {
    render(<MemoryRouter initialEntries={["/principal/teacher-feedback?campaign=campaign-3"]}>
      <Routes>
        <Route path="/principal/teacher-feedback" element={<PrincipalFeedbackPage />} />
        <Route path="/more/feedback" element={<Destination />} />
      </Routes>
    </MemoryRouter>);

    expect(await screen.findByText("/more/feedback?campaign=campaign-3&view=coordinate")).toBeVisible();
  });
});
