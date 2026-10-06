import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { StudentModulesPage } from "./StudentModulesPage";

vi.mock("./StudentShell", () => ({
  StudentShell: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

describe("student module catalogue", () => {
  it("exposes published results and opens the student results route", () => {
    render(
      <MemoryRouter initialEntries={["/student/apps"]}>
        <Routes>
          <Route path="/student/apps" element={<StudentModulesPage />} />
          <Route path="/student/results" element={<p>Student results opened</p>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "Results" })).toBeInTheDocument();
    expect(screen.getByText("Published marksheets, grades, and assessment feedback")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open Results" }));
    expect(screen.getByText("Student results opened")).toBeInTheDocument();
  });
});
