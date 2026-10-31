import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceAssignedClassRoute, WorkspaceAssignedClassesRoute } from "./PeopleClassWorkspaceRoutes";

const boundary = vi.hoisted(() => vi.fn());

vi.mock("../workspace/WorkspaceSurfaceOnly", () => ({
  WorkspaceSurfaceOnly: ({ areaKey, surfaceKey, children }: { areaKey: string; surfaceKey: string; children: ReactNode }) => {
    boundary(areaKey, surfaceKey);
    return <>{children}</>;
  },
}));
vi.mock("./TeacherClassesPage", () => ({ AssignedClassesPage: () => <p>Assigned classes directory</p> }));
vi.mock("./TeacherClassPage", () => ({ AssignedClassPage: () => <p>Assigned class detail</p> }));

afterEach(() => {
  cleanup();
  boundary.mockClear();
});

describe("People class workspace routes", () => {
  it("opens the directory only through the composed classes surface", () => {
    render(<WorkspaceAssignedClassesRoute />);
    expect(screen.getByText("Assigned classes directory")).toBeVisible();
    expect(boundary).toHaveBeenCalledWith("people", "classes");
  });

  it("keeps class detail behind the same responsibility surface", () => {
    render(<WorkspaceAssignedClassRoute />);
    expect(screen.getByText("Assigned class detail")).toBeVisible();
    expect(boundary).toHaveBeenCalledWith("people", "classes");
  });
});
