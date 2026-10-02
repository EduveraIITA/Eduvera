import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "./AuthContext";

const apiFetchMock = vi.hoisted(() => vi.fn());

vi.mock("../../lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/api")>();
  return { ...original, apiFetch: apiFetchMock };
});

const adminUser = {
  id: "admin-1",
  username: "meera.kapoor",
  email: "meera.kapoor@example.test",
  first_name: "Meera",
  last_name: "Kapoor",
  display_name: "Meera Kapoor",
  role: "admin" as const,
  active_school_id: "school-1",
};

function AuthProbe() {
  const auth = useAuth();
  return (
    <div>
      <span data-testid="status">{auth.status}</span>
      <span data-testid="demo-mode">{String(auth.demoMode)}</span>
      <span data-testid="user">{auth.user?.display_name ?? "none"}</span>
      <button type="button" onClick={() => void auth.login({ identifier: "meera.principal", password: "password" })}>Sign in</button>
      <button type="button" onClick={() => void auth.register({ email: "new@example.test", password: "secure-password", first_name: "New", last_name: "User", role: "student" })}>Sign up</button>
      <button type="button" onClick={() => void auth.enterDemo("admin")}>Principal demo</button>
      <button type="button" onClick={() => void auth.logout()}>Sign out</button>
    </div>
  );
}

function renderAuth() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider><AuthProbe /></AuthProvider>
    </QueryClientProvider>,
  );
}

describe("AuthProvider logout", () => {
  afterEach(cleanup);

  beforeEach(() => {
    window.localStorage.clear();
    apiFetchMock.mockReset();
  });

  it("stays signed out when server-side session cleanup fails", async () => {
    apiFetchMock.mockImplementation((path: string) => {
      if (path === "/api/v1/auth/session/") {
        return Promise.resolve({ authenticated: true, user: adminUser, csrf_token: "csrf", demo_mode: true });
      }
      if (path === "/api/v1/auth/me/") {
        return Promise.resolve({
          user: adminUser,
          students: [],
          memberships: [{ id: "membership-1", school_id: "school-1", school_name: "CIS", role: "admin" }],
          demo_mode: true,
        });
      }
      if (path === "/api/v1/auth/logout/") return Promise.reject(new Error("logout endpoint unavailable"));
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });

    const firstRender = renderAuth();
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("authenticated"));

    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("anonymous"));
    expect(window.localStorage.getItem("omnischool:explicitly-logged-out")).toBe("1");
    expect(window.localStorage.getItem("omnischool:logged-out-demo-mode")).toBe("1");
    expect(apiFetchMock).toHaveBeenCalledWith("/api/v1/auth/logout/", { method: "POST" });

    firstRender.unmount();
    apiFetchMock.mockClear();
    renderAuth();

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("anonymous"));
    expect(screen.getByTestId("demo-mode")).toHaveTextContent("true");
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it("recovers a transient CSRF bootstrap and signs in after an explicit logout", async () => {
    window.localStorage.setItem("omnischool:explicitly-logged-out", "1");
    let csrfAttempts = 0;
    apiFetchMock.mockImplementation((path: string) => {
      if (path === "/api/v1/auth/csrf/") {
        csrfAttempts += 1;
        return csrfAttempts === 1 ? Promise.reject(new TypeError("proxy restarting")) : Promise.resolve({ csrf_token: "fresh" });
      }
      if (path === "/api/v1/auth/login/") return Promise.resolve({ user: adminUser, csrf_token: "fresh", demo_mode: true });
      if (path === "/api/v1/auth/me/") return Promise.resolve({
        user: adminUser,
        students: [],
        memberships: [{ id: "membership-1", school_id: "school-1", school_name: "CIS", role: "admin" }],
        demo_mode: true,
      });
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });

    renderAuth();
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("anonymous"));
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("authenticated"));
    expect(screen.getByTestId("user")).toHaveTextContent("Meera Kapoor");
    expect(csrfAttempts).toBe(2);
    expect(window.localStorage.getItem("omnischool:explicitly-logged-out")).toBeNull();
  });

  it.each([
    ["Sign up", "/api/v1/auth/register/"],
    ["Principal demo", "/api/v1/auth/demo-session/"],
  ])("establishes a new authenticated session through %s", async (buttonName, endpoint) => {
    window.localStorage.setItem("omnischool:explicitly-logged-out", "1");
    apiFetchMock.mockImplementation((path: string) => {
      if (path === "/api/v1/auth/csrf/") return Promise.resolve({ csrf_token: "fresh" });
      if (path === endpoint) return Promise.resolve({ user: adminUser, csrf_token: "fresh", demo_mode: true });
      if (path === "/api/v1/auth/me/") return Promise.resolve({
        user: adminUser,
        students: [],
        memberships: [{ id: "membership-1", school_id: "school-1", school_name: "CIS", role: "admin" }],
        demo_mode: true,
      });
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });

    renderAuth();
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("anonymous"));
    await userEvent.click(screen.getByRole("button", { name: buttonName }));
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("authenticated"));
    expect(window.localStorage.getItem("omnischool:explicitly-logged-out")).toBeNull();
  });
});
