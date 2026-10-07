import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StudentModulesPage } from "./StudentModulesPage";

vi.mock("./StudentShell", () => ({
  StudentShell: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

describe("student module catalogue", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(cleanup);
  it("exposes published results and opens the student results route", () => {
    render(
      <QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={["/student/apps"]}>
        <Routes>
          <Route path="/student/apps" element={<StudentModulesPage />} />
          <Route path="/student/results" element={<p>Student results opened</p>} />
        </Routes>
      </MemoryRouter></QueryClientProvider>,
    );

    expect(screen.getByRole("link", { name: "Open Results" })).toBeInTheDocument();
    expect(screen.getByText("Your published assessment results and feedback")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: "Open Results" }));
    expect(screen.getByText("Student results opened")).toBeInTheDocument();
  });

  it("switches between grid and list without losing the catalogue", () => {
    render(<QueryClientProvider client={new QueryClient()}><MemoryRouter>
      <StudentModulesPage />
    </MemoryRouter></QueryClientProvider>);
    expect(screen.getByRole("button", { name: "List view" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Grid view" }));
    expect(screen.getByRole("button", { name: "Grid view" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "List view" }));
    expect(screen.getByRole("button", { name: "List view" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("link", { name: "Open Results" })).toBeInTheDocument();
  });
});
