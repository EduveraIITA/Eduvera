import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "../../lib/api";
import JoinPage from "./JoinPage";

const auth = vi.hoisted(() => ({ status: "authenticated", user: { id: "recipient", email: "amit@example.test" }, memberships: [] as Array<{ school_id: string; school_name: string }>, executionEnvironment: { mode: "live" }, refresh: vi.fn(), logout: vi.fn() }));
vi.mock("../../lib/api", async original => ({ ...await original<typeof import("../../lib/api")>(), apiFetch: vi.fn() }));
vi.mock("../auth/AuthContext", () => ({ useAuth: () => auth, authDestination: () => "/today" }));
const school = "22d09fe4-a034-4526-ac31-ae882e876460", invitation = "d299b001-38ab-4b14-9626-231cfb6e0706", repair = "f6627f0f-331d-4189-a246-27952704e7c3";
const continuation = { kind: "facility_repair", invitation_id: invitation, school_id: school, source_id: repair, href: `/areas/facilities?repair_id=${repair}`, label: "Open repair" };
const locator = `/join?campus=${school}&invitation=${invitation}`;
const endpoint = `/api/v1/schools/${school}/invitations/${invitation}/continuation/`;
const proof = { invitation_id: invitation, campus: { id: school, name: "Aaranya" }, verification_required: false, delivery: "not_required" };
beforeEach(() => {
  vi.clearAllMocks(); auth.status = "authenticated"; auth.user = { id: "recipient", email: "amit@example.test" }; auth.memberships = [{ school_id: school, school_name: "Aaranya" }]; auth.executionEnvironment = { mode: "live" };
  vi.mocked(apiFetch).mockImplementation(path => Promise.resolve(path.endsWith("recipient-proof/") ? proof : path.endsWith("accept/") ? { school_id: school, role: "member", accepted_user_id: "recipient", continuation } : path === endpoint ? continuation : {}));
});
afterEach(cleanup);
function Location() { const location = useLocation(); return <span data-testid="location">{location.pathname}{location.search}</span>; }
function mount(path = locator) { render(<MemoryRouter initialEntries={[path]}><JoinPage /><Location /></MemoryRouter>); }
async function accept() { mount("/join#email=amit%40example.test&token=012345"); await userEvent.click(screen.getByRole("button", { name: "Continue" })); await userEvent.type(screen.getByLabelText("Name"), "Amit Kumar"); await userEvent.type(screen.getByLabelText("Password"), "Existing!Password2026"); await userEvent.click(screen.getByRole("button", { name: "Accept invitation" })); }

describe("validated exact repair invitation continuation", () => {
  it("opens the assigned repair only after selecting campus and freshly validating server context", async () => {
    mount(); await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent(continuation.href));
    const calls = vi.mocked(apiFetch).mock.calls.map(([path]) => path);
    expect(calls.indexOf("/api/v1/auth/active-school/")).toBeLessThan(calls.indexOf(endpoint));
    expect(calls).toContain(endpoint);
  });
  it("returns the same-account acceptance directly to its exact repair without a visitor portal", async () => {
    await accept(); await userEvent.click(await screen.findByRole("button", { name: "Open repair" }));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent(continuation.href));
    expect(apiFetch).toHaveBeenCalledWith(endpoint);
  });
  it("preserves only campus and invitation UUIDs through a different account’s sign-in", async () => {
    auth.user = { id: "other", email: "other@example.test" };
    await accept(); await userEvent.click(await screen.findByRole("button", { name: "Sign in with invited account" }));
    expect(auth.logout).toHaveBeenCalledOnce(); expect(screen.getByTestId("location")).toHaveTextContent(`/login?next=${encodeURIComponent(locator)}`);
    expect(screen.getByTestId("location")).not.toHaveTextContent("012345");
  });
  it("keeps the invitation locator during sign-in recovery from a lost acceptance response", async () => {
    vi.mocked(apiFetch).mockImplementation(path => path.endsWith("recipient-proof/") ? Promise.resolve(proof) : path.endsWith("accept/") ? Promise.reject(new Error("Response lost")) : Promise.resolve({}));
    await accept(); await userEvent.click(await screen.findByRole("button", { name: "Use sign-in recovery" }));
    expect(screen.getByTestId("location")).toHaveTextContent(`/login?next=${encodeURIComponent(locator)}`);
  });
  it.each([{ ...continuation, href: "https://example.test/private" }, { ...continuation, source_id: "another-source" }, { ...continuation, kind: "staff_portal" }, { ...continuation, school_id: invitation }])("refuses an unvalidated source destination %#", async unsafe => {
    vi.mocked(apiFetch).mockImplementation(path => Promise.resolve(path === endpoint ? unsafe : {}));
    mount(); await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("could not be verified"); expect(screen.getByTestId("location")).toHaveTextContent(locator);
  });
  it("does not fetch or switch Live when the invitation is opened in Simulation", () => {
    auth.executionEnvironment = { mode: "simulation" }; mount();
    expect(screen.getByRole("heading", { name: "Joining is managed in Live" })).toBeVisible(); expect(apiFetch).not.toHaveBeenCalled();
  });
  it("opens a shared visit only from fresh validated server metadata", async () => {
    const visitContinuation = { ...continuation, kind: "visit_arrangement", href: `/areas/in-out/visits?visit=${repair}&shared=1`, label: "Open visit" };
    vi.mocked(apiFetch).mockImplementation(path => Promise.resolve(path === endpoint ? visitContinuation : {}));
    mount(); expect(screen.queryByText("Open your repair job")).not.toBeInTheDocument(); await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent(visitContinuation.href));
  });
  it("returns same-account visit acceptance to the shared source without another confirmation", async () => {
    const visitContinuation = { ...continuation, kind: "visit_arrangement", href: `/areas/in-out/visits?visit=${repair}&shared=1`, label: "Open visit" };
    vi.mocked(apiFetch).mockImplementation(path => Promise.resolve(path.endsWith("recipient-proof/") ? proof : path.endsWith("accept/") ? { school_id: school, role: "member", accepted_user_id: "recipient", continuation: visitContinuation } : path === endpoint ? visitContinuation : {}));
    await accept(); await userEvent.click(await screen.findByRole("button", { name: "Open visit" }));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent(visitContinuation.href));
  });
  it.each([`/areas/in-out/visits?visit=${repair}`, `/areas/in-out/visits?visit=${repair}&shared=1&campus=other`])("refuses a visit href that is not the exact canonical shared destination %s", async href => {
    vi.mocked(apiFetch).mockImplementation(path => Promise.resolve(path === endpoint ? { ...continuation, kind: "visit_arrangement", label: "Open visit", href } : {}));
    mount(); await userEvent.click(screen.getByRole("button", { name: "Continue" })); expect(await screen.findByRole("alert")).toHaveTextContent("could not be verified"); expect(screen.getByTestId("location")).toHaveTextContent(locator);
  });
});
