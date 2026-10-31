import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "../../lib/api";
import { ForgotPasswordPage, ResetPasswordPage } from "./AccountSecurityPages";

vi.mock("../../lib/api", async original => ({ ...await original<typeof import("../../lib/api")>(), apiFetch: vi.fn() }));
beforeEach(() => { vi.mocked(apiFetch).mockReset(); });
afterEach(cleanup);
function show(reset = false, path = "/forgot-password") {
  return render(<MemoryRouter initialEntries={[path]}>{reset ? <ResetPasswordPage /> : <ForgotPasswordPage />}</MemoryRouter>);
}
describe("focused account recovery", () => {
  it("keeps the email request private and preserves the CSRF-before-mutation ceremony", async () => {
    vi.mocked(apiFetch).mockResolvedValue({});
    show();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    await userEvent.type(screen.getByLabelText("Email address"), "owner@example.test");
    await userEvent.click(screen.getByRole("button", { name: "Send reset link" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Check your email" })).toBeVisible();
    expect(screen.getByText("If an active account matches, a reset link is on its way.")).toBeVisible();
    expect(apiFetch).toHaveBeenNthCalledWith(1, "/api/v1/auth/csrf/");
    expect(apiFetch).toHaveBeenNthCalledWith(2, "/api/v1/auth/password-reset/request/", { method: "POST", body: JSON.stringify({ email: "owner@example.test" }) });
    expect(screen.getByRole("link", { name: "Back to sign in" })).toHaveAttribute("href", "/login");
  });

  it("retains the entered email on a recoverable service failure", async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce({}).mockRejectedValueOnce(new Error("Please try again shortly."));
    show();
    await userEvent.type(screen.getByLabelText("Email address"), "owner@example.test");
    await userEvent.click(screen.getByRole("button", { name: "Send reset link" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Please try again shortly.");
    expect(screen.getByLabelText("Email address")).toHaveValue("owner@example.test");
    expect(screen.getByRole("button", { name: "Send reset link" })).toBeEnabled();
  });

  it("focuses a supplied reset link on the two password fields and sends the unchanged token", async () => {
    vi.mocked(apiFetch).mockResolvedValue({});
    show(true, "/reset-password?token=single-use-reset-token");
    expect(screen.getByLabelText("Reset token")).toHaveValue("single-use-reset-token");
    expect(screen.getByLabelText("Reset token")).not.toBeVisible();
    expect(screen.getByLabelText("New password")).toHaveAttribute("autocomplete", "new-password");
    expect(screen.getByLabelText("New password")).toHaveAttribute("minlength", "12");
    await userEvent.type(screen.getByLabelText("New password"), "Fresh!RiverStone2026");
    await userEvent.type(screen.getByLabelText("Confirm password"), "Fresh!RiverStone2026");
    await userEvent.click(screen.getByRole("button", { name: "Update password" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Password updated" })).toBeVisible();
    expect(screen.getByText("Your previous sessions are signed out.")).toBeVisible();
    expect(apiFetch).toHaveBeenNthCalledWith(1, "/api/v1/auth/csrf/");
    expect(apiFetch).toHaveBeenNthCalledWith(2, "/api/v1/auth/password-reset/confirm/", { method: "POST", body: JSON.stringify({ token: "single-use-reset-token", password: "Fresh!RiverStone2026" }) });
  });

  it("keeps mismatched passwords local and offers a fresh link after an expired-token refusal", async () => {
    show(true, "/reset-password?token=expired-token");
    await userEvent.type(screen.getByLabelText("New password"), "Fresh!RiverStone2026");
    await userEvent.type(screen.getByLabelText("Confirm password"), "Other!RiverStone2026");
    await userEvent.click(screen.getByRole("button", { name: "Update password" }));
    expect(screen.getByRole("alert")).toHaveTextContent("The passwords do not match.");
    expect(apiFetch).not.toHaveBeenCalled();
    vi.mocked(apiFetch).mockResolvedValueOnce({}).mockRejectedValueOnce(new Error("Reset link has expired."));
    await userEvent.clear(screen.getByLabelText("Confirm password"));
    await userEvent.type(screen.getByLabelText("Confirm password"), "Fresh!RiverStone2026");
    await userEvent.click(screen.getByRole("button", { name: "Update password" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Reset link has expired.");
    expect(screen.getByRole("link", { name: "Request a new reset link" })).toHaveAttribute("href", "/forgot-password");
    expect(screen.getByLabelText("New password")).toHaveValue("Fresh!RiverStone2026");
  });

  it("opens manual token entry when no reset link was supplied", () => {
    show(true, "/reset-password");
    expect(screen.getByLabelText("Reset token")).toBeVisible();
    expect(screen.getByLabelText("Reset token")).toBeRequired();
  });
});
