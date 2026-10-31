import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WorkspacePeopleRoute } from "./PeopleWorkspaceRoutes";

vi.mock("../workspace/WorkspaceAreaRoutePage", () => ({
  WorkspaceAreaRoutePage: ({ areaKey }: { areaKey: string }) => <div data-testid="area-resolver">{areaKey}</div>,
}));

describe("responsibility-composed People workspace", () => {
  it("delegates contribution selection to the server-composed Area resolver", () => {
    render(<WorkspacePeopleRoute />);
    expect(screen.getByTestId("area-resolver")).toHaveTextContent("people");
  });
});
