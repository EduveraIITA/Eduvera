import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TestQueryProvider } from "../../test/TestQueryProvider";
import { ParentShell } from "./ParentShell";

vi.mock("../../features/school/api", async (original) => ({
  ...await original<typeof import("../../features/school/api")>(),
  getAccessibleStudents: vi.fn().mockResolvedValue({ results: [] }),
}));
afterEach(cleanup);

describe("family identity accent isolation", () => {
  it("keeps a second child's identity cues without injecting a second application palette", () => {
    const { container } = render(<TestQueryProvider><MemoryRouter>
      <ParentShell active="timetable" pageLabel="Timetable" selectedChildId="child-two" childOptions={[
        { id: "child-one", name: "First learner", grade: "7", section: "A" },
        { id: "child-two", name: "Second learner", grade: "5", section: "B" },
      ]}><p>Family schedule</p></ParentShell>
    </MemoryRouter></TestQueryProvider>);
    const shell = container.querySelector<HTMLElement>(".parent-app")!;
    expect(shell.dataset.childAccent).toBe("violet");
    expect(shell.style.getPropertyValue("--profile-accent")).toBe("#7436bd");
    for (const variable of ["--thatcampus-brand", "--thatcampus-brand-bright", "--thatcampus-brand-soft", "--thatcampus-feature-gradient", "--parent-primary", "--primary", "--surface-low"]) {
      expect(shell.style.getPropertyValue(variable)).toBe("");
    }
  });
});
