import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { StudentAttendancePage } from "./StudentAttendancePage";
import { TestQueryProvider } from "../../test/TestQueryProvider";

afterEach(cleanup);

describe("StudentAttendancePage", () => {
  it("updates the projected aggregate through the accessible what-if stepper", async () => {
    const user = userEvent.setup();

    render(
      <TestQueryProvider><MemoryRouter>
        <StudentAttendancePage />
      </MemoryRouter></TestQueryProvider>,
    );

    await user.click(screen.getByText('Plan an absence'));
    const stepper = screen.getByRole("group", { name: "Projected absences" });
    const increase = within(stepper).getByRole("button", { name: "Increase projected absences" });

    expect(within(stepper).getByText("1")).toBeVisible();
    expect(screen.getByText(/93\.7%/)).toBeVisible();

    await user.click(increase);

    expect(within(stepper).getByText("2")).toBeVisible();
    expect(screen.getByText(/93\.0%/)).toBeVisible();
  });
});
