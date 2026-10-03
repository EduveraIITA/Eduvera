import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StudentIdentityCard, type StudentIdentity } from "./StudentIdentityCard";

vi.mock("qrcode", () => ({
  toDataURL: vi.fn().mockResolvedValue("data:image/png;base64,identity"),
}));

const identity: StudentIdentity = {
  studentName: "Aarav Sharma",
  avatarUrl: "/assets/aarav-sharma.png",
  className: "Class 7A",
  rollNumber: "17",
  studentId: "CIS-2023-071",
  termLabel: "Term 1 - 2026-27",
  dateLabel: "Saturday, 3 October",
  attendancePercent: 95,
  attendanceThreshold: 85,
};

afterEach(cleanup);

describe("StudentIdentityCard", () => {
  it("opens as a body-level modal, locks page scroll and restores focus on Escape", async () => {
    const user = userEvent.setup();
    render(<StudentIdentityCard identity={identity} />);
    const trigger = screen.getByRole("button", { name: /Open digital student ID for Aarav Sharma/ });

    await user.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "Aarav Sharma" });
    const close = screen.getByRole("button", { name: "Close digital student ID" });
    expect(dialog.parentElement).toBe(document.body);
    expect(document.body.style.overflow).toBe("hidden");
    await waitFor(() => expect(close).toHaveFocus());

    fireEvent.keyDown(window, { key: "Tab" });
    expect(close).toHaveFocus();
    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe("");
    expect(trigger).toHaveFocus();
  });

  it("closes from the explicit close control", async () => {
    const user = userEvent.setup();
    render(<StudentIdentityCard identity={identity} />);
    await user.click(screen.getByRole("button", { name: /Open digital student ID/ }));
    await user.click(screen.getByRole("button", { name: "Close digital student ID" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
