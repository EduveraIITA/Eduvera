import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { TestQueryProvider } from "../../test/TestQueryProvider";
import { fallbackAttendanceData } from "./parentDemoData";
import { ParentAttendancePage } from "./ParentAttendancePage";

afterEach(cleanup);

describe("ParentAttendancePage", () => {
  it("embeds the dependent record and keeps its real actions without a parent portal shell", async () => {
    const requestLeave = vi.fn();
    const messageTeacher = vi.fn();
    const { container } = render(
      <TestQueryProvider><MemoryRouter>
        <ParentAttendancePage
          data={fallbackAttendanceData}
          embedded
          onRequestLeave={requestLeave}
          onMessageTeacher={messageTeacher}
        />
      </MemoryRouter></TestQueryProvider>,
    );

    expect(container.querySelector(".parent-app")).not.toBeInTheDocument();
    expect(screen.getByText("94.2%")).toBeVisible();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Request Leave/ }));
    await user.click(screen.getByRole("button", { name: "Message Homeroom Advisor" }));
    expect(requestLeave).toHaveBeenCalledOnce();
    expect(messageTeacher).toHaveBeenCalledOnce();
  });
});
