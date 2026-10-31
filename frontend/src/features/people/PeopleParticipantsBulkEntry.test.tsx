import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../lib/api";
import { ExecutionEnvironmentProvider } from "../simulation/ExecutionEnvironmentContext";
import type { ExecutionEnvironment } from "../simulation/executionEnvironment";
import { listParticipants } from "./participationApi";
import { PeopleParticipantsPage } from "./PeopleParticipantsPage";

type AcceptedPerson = { id: string; label: string; affiliations: string[] };
const captured = vi.hoisted(() => ({ onDone: undefined as undefined | ((people: AcceptedPerson[]) => void) }));
const auth = vi.hoisted(() => ({ user: { id: "owner", active_school_id: "campus" } }));
vi.mock("../auth/AuthContext", () => ({ useAuth: () => auth }));
vi.mock("../../pages/operations/OperationsShell", () => ({ OperationsShell: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock("./participationApi", async original => ({ ...await original<typeof import("./participationApi")>(), listParticipants: vi.fn() }));
vi.mock("./PeopleBulkAddDialog", () => ({ PeopleBulkAddDialog: ({ schoolId, onClose, onDone }: { schoolId: string; onClose: () => void; onDone: (people: AcceptedPerson[]) => void }) => {
  captured.onDone = onDone;
  return <section role="dialog" aria-label="Shared Add people"><p>{schoolId}</p><button type="button" onClick={onClose}>Cancel shared add</button><button type="button" onClick={() => onDone([{ id: "new", label: "New Person", affiliations: [] }, { id: "existing", label: "Explicitly Reused Person", affiliations: [] }, { id: "existing", label: "Explicitly Reused Person", affiliations: [] }])}>Finish accepted people</button><button type="button" onClick={() => onDone([{ id: "one", label: "One Person", affiliations: [] }])}>Finish one person</button></section>;
} }));

function Location() {
  const location = useLocation(), state = location.state as { peopleReturnTo?: string } | null;
  return <><output data-testid="location">{location.pathname}{location.search}</output><output data-testid="return-to">{state?.peopleReturnTo}</output></>;
}
function mount(path = "/areas/people/participants?search=Person&page=2", initialEnvironment: ExecutionEnvironment = { mode: "live" }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (environment: ExecutionEnvironment) => <QueryClientProvider client={client}><ExecutionEnvironmentProvider environment={environment}><MemoryRouter initialEntries={[path]}><Routes><Route path="/areas/people/participants/:personId" element={<p>Canonical profile</p>} /><Route path="*" element={<PeopleParticipantsPage />} /></Routes><Location /></MemoryRouter></ExecutionEnvironmentProvider></QueryClientProvider>;
  const result = render(tree(initialEnvironment));
  return { client, changeEnvironment: (environment: ExecutionEnvironment) => result.rerender(tree(environment)) };
}
beforeEach(() => {
  vi.clearAllMocks(); captured.onDone = undefined; auth.user.id = "owner"; auth.user.active_school_id = "campus";
  vi.mocked(listParticipants).mockResolvedValue({ results: [{ id: "visible", label: "Visible Person", affiliations: [], has_account: false }], page: 2, page_size: 25, total: 26 });
});
afterEach(cleanup);

describe("People directory shared add entry", () => {
  it("keeps the new chooser disabled until its current authorized directory read succeeds", async () => {
    vi.mocked(listParticipants).mockImplementation(() => new Promise(() => undefined));
    mount();
    expect(screen.getByRole("button", { name: "Add people" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Add people" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps filter and page after accepted bulk work and refreshes only current-world People and catalogue", async () => {
    const { client } = mount(); await screen.findByText("Visible Person");
    const catalogueKey = ["execution-environment", "live", "activities", "campus", "actor", "owner", "catalogue"];
    client.setQueryData(catalogueKey, { people: [] });
    const invalidate = vi.spyOn(client, "invalidateQueries");
    await userEvent.click(screen.getByRole("button", { name: "Add people" }));
    expect(screen.getByRole("dialog", { name: "Shared Add people" })).toHaveTextContent("campus");
    await userEvent.click(screen.getByRole("button", { name: "Finish accepted people" }));
    expect(screen.getByText("2 people ready. App access is unchanged.")).toBeVisible();
    expect(screen.getByTestId("location")).toHaveTextContent("/areas/people/participants?search=Person&page=2");
    expect(screen.getByText("Page 2 of 2")).toBeVisible();
    expect(invalidate.mock.calls).toEqual([
      [{ queryKey: ["execution-environment", "live", "people.participants", "campus"] }],
      [{ queryKey: ["execution-environment", "live", "activities", "campus"] }],
    ]);
    expect(client.getQueryState(catalogueKey)?.isInvalidated).toBe(true);
    await waitFor(() => expect(screen.getByRole("button", { name: "Add people" })).toHaveFocus());
  });

  it("opens one exact accepted person's profile and retains the originating directory state", async () => {
    mount(); await screen.findByText("Visible Person");
    await userEvent.click(screen.getByRole("button", { name: "Add people" }));
    await userEvent.click(screen.getByRole("button", { name: "Finish one person" }));
    expect(screen.getByText("Canonical profile")).toBeVisible();
    expect(screen.getByTestId("location")).toHaveTextContent("/areas/people/participants/one");
    expect(screen.getByTestId("return-to")).toHaveTextContent("/areas/people/participants?search=Person&page=2");
  });

  it("keeps accepted Simulation work and invalidations inside the exact selected run", async () => {
    const { client } = mount(undefined, { mode: "simulation", namespaceId: "scenario", runId: "run", runStatus: "running", virtualClock: { now: "2026-10-21T10:00:00Z", timeZone: "UTC" } });
    await screen.findByText("Visible Person");
    const catalogueKey = ["execution-environment", "simulation", "scenario", "run", "activities", "campus", "actor", "owner", "catalogue"];
    const liveKey = ["execution-environment", "live", "activities", "campus", "actor", "owner", "catalogue"];
    const siblingKey = ["execution-environment", "simulation", "sibling", "other-run", "activities", "campus", "actor", "owner", "catalogue"];
    for (const key of [catalogueKey, liveKey, siblingKey]) client.setQueryData(key, { people: [] });
    const invalidate = vi.spyOn(client, "invalidateQueries");
    await userEvent.click(screen.getByRole("button", { name: "Add people" }));
    await userEvent.click(screen.getByRole("button", { name: "Finish accepted people" }));
    expect(screen.getByText("2 people ready. App access is unchanged.")).toBeVisible();
    expect(invalidate.mock.calls).toEqual([
      [{ queryKey: ["execution-environment", "simulation", "scenario", "run", "people.participants", "campus"] }],
      [{ queryKey: ["execution-environment", "simulation", "scenario", "run", "activities", "campus"] }],
    ]);
    expect(client.getQueryState(catalogueKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(liveKey)?.isInvalidated).toBe(false);
    expect(client.getQueryState(siblingKey)?.isInvalidated).toBe(false);
  });

  it("cancels without an invented receipt, mutation refresh or loss of directory position", async () => {
    const { client } = mount(); await screen.findByText("Visible Person");
    const invalidate = vi.spyOn(client, "invalidateQueries");
    await userEvent.click(screen.getByRole("button", { name: "Add people" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel shared add" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText(/people ready/)).not.toBeInTheDocument();
    expect(invalidate).not.toHaveBeenCalled();
    expect(screen.getByTestId("location")).toHaveTextContent("search=Person&page=2");
    await waitFor(() => expect(screen.getByRole("button", { name: "Add people" })).toHaveFocus());
  });

  it("hides the chooser and ignores late completion after a current access denial", async () => {
    const { client } = mount(); await screen.findByText("Visible Person");
    await userEvent.click(screen.getByRole("button", { name: "Add people" }));
    const onDone = captured.onDone;
    vi.mocked(listParticipants).mockRejectedValue(new ApiError("People access changed.", 403));
    await act(async () => { await client.invalidateQueries({ queryKey: ["execution-environment", "live", "people.participants", "campus"] }); });
    expect(await screen.findByRole("alert")).toHaveTextContent("People access changed.");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add people" })).toBeDisabled();
    act(() => onDone?.([{ id: "foreign", label: "Late result", affiliations: [] }]));
    expect(screen.getByTestId("location")).toHaveTextContent("search=Person&page=2");
    expect(screen.queryByText("Canonical profile")).not.toBeInTheDocument();
  });

  it("discards an old world's chooser and ignores its late callback after switching context", async () => {
    const { changeEnvironment, client } = mount(); await screen.findByText("Visible Person");
    await userEvent.click(screen.getByRole("button", { name: "Add people" }));
    const onDone = captured.onDone;
    changeEnvironment({ mode: "simulation", namespaceId: "scenario", runId: "run", runStatus: "running", virtualClock: { now: "2026-10-21T10:00:00Z", timeZone: "UTC" } });
    await screen.findByText("Visible Person");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    act(() => onDone?.([{ id: "live-only", label: "Old Live result", affiliations: [] }]));
    expect(invalidate).not.toHaveBeenCalled();
    expect(screen.getByTestId("location")).toHaveTextContent("search=Person&page=2");
    expect(screen.queryByText("Canonical profile")).not.toBeInTheDocument();
  });

  it("does not apply a previous account's late completion after the signed-in actor changes", async () => {
    const { changeEnvironment, client } = mount(); await screen.findByText("Visible Person");
    await userEvent.click(screen.getByRole("button", { name: "Add people" }));
    const onDone = captured.onDone;
    auth.user.id = "another-actor";
    changeEnvironment({ mode: "live" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    act(() => onDone?.([{ id: "prior-actor", label: "Old actor result", affiliations: [] }]));
    expect(invalidate).not.toHaveBeenCalled();
    expect(screen.getByTestId("location")).toHaveTextContent("search=Person&page=2");
    expect(screen.queryByText("Canonical profile")).not.toBeInTheDocument();
  });
});
