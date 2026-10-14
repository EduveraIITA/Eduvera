import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import ExperimentalSettingsPage from "./ExperimentalSettingsPage";
import { readTimetableExperience } from "./timetableExperience";

vi.mock("../auth/AuthContext", () => ({ useOptionalAuth: () => ({ user: { id: "principal-1" } }) }));
vi.mock("../../pages/operations/OperationsShell", () => ({ OperationsShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }));

describe("timetable experiment preference", () => {
  beforeEach(() => window.localStorage.clear());

  it("keeps the current timetable as the safe default and persists an explicit timeline choice", () => {
    render(<MemoryRouter><ExperimentalSettingsPage /></MemoryRouter>);
    expect(screen.getByRole("radio", { name: /Current/ })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("radio", { name: /Timeline/ }));
    expect(readTimetableExperience("principal-1")).toBe("timeline");
    expect(screen.getByRole("radio", { name: /Timeline/ })).toHaveAttribute("aria-checked", "true");
  });
});
