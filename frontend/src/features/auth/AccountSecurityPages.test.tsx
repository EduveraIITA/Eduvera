import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AccountSecurityPage } from "./AccountSecurityPages";

const apiFetchMock = vi.hoisted(() => vi.fn());
let authState: Record<string, unknown>;

vi.mock("../../lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/api")>();
  return { ...original, apiFetch: apiFetchMock };
});

vi.mock("./AuthContext", () => ({ useAuth: () => authState, authDestination: () => "/today" }));

function renderPage(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}><AccountSecurityPage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

function renderNavigationPage(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Destination() {
    const location=useLocation();
    return <output data-testid="destination">{location.pathname}{location.search}{location.hash}</output>;
  }
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}><Routes>
        <Route path="/account/security" element={<AccountSecurityPage />} />
        <Route path="/gate" element={<Destination />} />
        <Route path="/today" element={<Destination />} />
      </Routes></MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  apiFetchMock.mockReset();
  authState = {
    status: "authenticated",
    user: { email: "owner@example.test", email_verified: false },
    onboarding: { status: "purpose_required" },
    refresh: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn().mockResolvedValue(undefined),
  };
});

afterEach(cleanup);

it("keeps first-run confirmation to one email task before purpose selection", async () => {
  apiFetchMock.mockResolvedValue({});
  const user = userEvent.setup();
  renderPage("/account/security?from=%2Fonboarding%2Fstart");

  expect(screen.getByRole("heading", { name: "Confirm your email" })).toBeVisible();
  expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  expect(screen.queryByRole("link", { name: "Continue" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Confirm email" })).toBeDisabled();
  expect(screen.queryByText("Two-step verification")).not.toBeInTheDocument();
  expect(apiFetchMock).not.toHaveBeenCalledWith("/api/v1/auth/mfa/");

  const token = "a".repeat(32);
  await user.type(screen.getByLabelText(/^Verification token/), token);
  await user.click(screen.getByRole("button", { name: "Confirm email" }));

  await waitFor(() => expect(apiFetchMock).toHaveBeenCalledWith(
    "/api/v1/auth/email-verification/confirm/",
    { method: "POST", body: JSON.stringify({ token }) },
  ));
  expect(authState.refresh).toHaveBeenCalled();
});

it("continues a verified first-run account directly to purpose selection", () => {
  authState = {
    ...authState,
    user: { email: "owner@example.test", email_verified: true },
  };
  renderPage("/account/security?from=%2Fonboarding%2Fstart");

  expect(screen.getByRole("heading", { name: "Email confirmed" })).toBeVisible();
  expect(screen.getByRole("heading", { name: "Email confirmed" })).toHaveProperty("tagName", "H1");
  expect(screen.queryByRole("heading", { name: "Confirm your email" })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Continue" })).toHaveAttribute("href", "/onboarding/start");
  expect(screen.getByText(/authenticator later from Account security/i)).toBeVisible();
});

it("preserves the full security and MFA workspace outside onboarding", async () => {
  authState = {
    ...authState,
    user: { email: "owner@example.test", email_verified: true },
    onboarding: { status: "ready" },
  };
  apiFetchMock.mockImplementation((path: string) => {
    if (path === "/api/v1/auth/mfa/") return Promise.resolve({ status: "not_enrolled", confirmed_at: null, recovery_codes_remaining: 0 });
    return Promise.reject(new Error(`Unexpected request: ${path}`));
  });
  renderPage("/account/security?from=%2Fprincipal%2Fmore");

  expect(screen.getByRole("heading", { name: "Account security" })).toBeVisible();
  expect(await screen.findByRole("heading", { name: "Two-step verification" })).toBeVisible();
  expect(await screen.findByRole("button", { name: /Set up authenticator/i })).toBeVisible();
});

it("returns a refreshed Security screen to the exact Gate workspace", async () => {
  authState = {
    ...authState,
    memberships: [{ role: "admin" }],
    user: { email: "owner@example.test", email_verified: true, role: "admin" },
    onboarding: { status: "ready" },
  };
  apiFetchMock.mockResolvedValue({ status: "not_enrolled", confirmed_at: null, recovery_codes_remaining: 0 });
  const origin="/gate?mode=scan#camera";
  renderNavigationPage(`/account/security?from=${encodeURIComponent(origin)}`);
  await userEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(await screen.findByTestId("destination")).toHaveTextContent("/gate?mode=scan#camera");
});

it("uses the authenticated home when Security has no safe return destination", async () => {
  authState = {
    ...authState,
    memberships: [{ role: "admin" }],
    user: { email: "owner@example.test", email_verified: true, role: "admin" },
    onboarding: { status: "ready" },
  };
  apiFetchMock.mockResolvedValue({ status: "not_enrolled", confirmed_at: null, recovery_codes_remaining: 0 });
  renderNavigationPage("/account/security?from=%2F%2Fevil.example%2Fgate");
  await userEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(await screen.findByTestId("destination")).toHaveTextContent("/today");
});
