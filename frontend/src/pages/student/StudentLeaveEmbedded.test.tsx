import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { StudentLeaveNewPage } from "./StudentLeaveNewPage";
import { demoLeaveStatusData, StudentLeaveStatusPage } from "./StudentLeaveStatusPage";

afterEach(cleanup);

describe("embedded learner leave surfaces", () => {
  it("keeps the complete application without a nested learner persona shell", () => {
    const { container } = render(
      <MemoryRouter initialEntries={["/areas/attendance/leave?scope=self&student_id=student-1&view=apply"]}>
        <StudentLeaveNewPage embedded />
      </MemoryRouter>,
    );
    expect(container.querySelector(".student-app--embedded")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Category" })).toBeVisible();
    expect(screen.queryByRole("navigation", { name: /student/i })).not.toBeInTheDocument();
  });

  it("keeps request progress, history and correction actions in the embedded status view", () => {
    const { container } = render(
      <MemoryRouter initialEntries={["/areas/attendance/leave?scope=self&student_id=student-1"]}>
        <StudentLeaveStatusPage embedded data={demoLeaveStatusData} onWithdraw={() => undefined} />
      </MemoryRouter>,
    );
    expect(container.querySelector(".student-app--embedded")).toBeInTheDocument();
    expect(screen.getByText("Request progress")).toBeVisible();
    expect(screen.getByRole("button", { name: "Withdraw" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Request history" })).toBeVisible();
  });
});
