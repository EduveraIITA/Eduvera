import type { ReactNode } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../lib/api";
import { ExecutionEnvironmentProvider } from "../simulation/ExecutionEnvironmentContext";
import type { ExecutionEnvironment } from "../simulation/executionEnvironment";
import { executionEnvironmentQueryKey } from "../simulation/executionEnvironmentQueryKey";
import { DiningActionDialog } from "./DiningActionDialog";
import { DiningCommandRecovery } from "./DiningCommandRecovery";
import { DiningWriteFeedback } from "./DiningPrimitives";
import { actOnDiningSession, confirmDiningCommand, type DiningAccepted, type DiningConfirmation } from "./diningApi";
import { sessionFixture } from "./dining.test-fixtures";
import { useDiningCommand } from "./useDiningCommand";

vi.mock("./diningApi", async original => ({ ...await original<typeof import("./diningApi")>(), actOnDiningSession: vi.fn(), confirmDiningCommand: vi.fn() }));
const live: ExecutionEnvironment = { mode: "live" };
const run = (runId: string): ExecutionEnvironment => ({ mode: "simulation", namespaceId: "simulation:dining", runId, runStatus: "running", virtualClock: { now: "2026-10-24T06:30:00Z", timeZone: "Asia/Kolkata" } });
const recoveryKey = (environment = live, actorId = "actor", schoolId = "school") => executionEnvironmentQueryKey(environment, ["dining-command-recovery", schoolId, actorId]);
const accepted: DiningAccepted = { id: "session-1", revision: 3, kind: "session" };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function wrapper(client: QueryClient, children: ReactNode, environment = live, actorId = "actor", schoolId = "school") {
  return <QueryClientProvider client={client}><ExecutionEnvironmentProvider environment={environment}><MemoryRouter><DiningCommandRecovery schoolId={schoolId} actorId={actorId}>{children}</DiningCommandRecovery></MemoryRouter></ExecutionEnvironmentProvider></QueryClientProvider>;
}
function client() { return new QueryClient({ defaultOptions: { queries: { retry: false } } }); }
function dialog(refresh = vi.fn().mockResolvedValue(undefined)) {
  return <DiningActionDialog schoolId="school" actorId="actor" initial={sessionFixture()} action="correct_count" timezone="Asia/Kolkata" refresh={refresh} onClose={vi.fn()} />;
}
async function submit() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Reason"), "Correct private desk tally");
  await user.click(screen.getByRole("checkbox", { name: /I reviewed this cumulative total/ }));
  await user.click(screen.getByRole("button", { name: "Correct serving total" }));
}
beforeAll(() => { HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); }; HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); }; });
beforeEach(() => { vi.spyOn(window, "confirm").mockReturnValue(true); });
afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe("exact Dining command recovery", () => {
  it.each([403, 422])("keeps a lost-response command after not_found and retry %i, then remounts its exact lookup", async status => {
    const cache = client(), user = userEvent.setup();
    vi.mocked(actOnDiningSession).mockRejectedValueOnce(new TypeError("Response lost")).mockRejectedValueOnce(new ApiError("Access or validation changed", status));
    vi.mocked(confirmDiningCommand).mockResolvedValueOnce({ state: "not_found" }).mockRejectedValueOnce(new ApiError("Access changed", 403)).mockResolvedValueOnce({ state: "accepted", result: accepted });
    const view = render(wrapper(cache, dialog()));
    await submit();
    await user.click(await screen.findByRole("button", { name: "Check result" }));
    await user.click(await screen.findByRole("button", { name: "Retry same action" }));
    await screen.findByText(/Access or validation changed/);
    const original = vi.mocked(actOnDiningSession).mock.calls[0]!, commandId = original[2].command_id;
    expect(vi.mocked(actOnDiningSession).mock.calls[1]).toEqual(original);
    expect(cache.getQueryData(recoveryKey())).toEqual([{ commandId, sourceId: "session-1", kind: "session", phase: "unknown", detached: false }]);
    expect(screen.getByLabelText("Reason")).toBeDisabled();
    view.unmount();
    // Ordinary source-cache replacement must not throw away exact recovery.
    cache.removeQueries({ queryKey: executionEnvironmentQueryKey(live, ["dining", "school", "actor"]) });
    render(wrapper(cache, null));
    expect(screen.queryByLabelText("Reason")).not.toBeInTheDocument();
    expect(JSON.stringify(cache.getQueryData(recoveryKey()))).not.toMatch(/private|count_total|observed_at|operation|Meera|Rice/);
    await user.click(await screen.findByRole("button", { name: "Check exact result" }));
    await screen.findByText("Access changed");
    expect(cache.getQueryData(recoveryKey())).toEqual([{ commandId, sourceId: "session-1", kind: "session", phase: "unknown", detached: true }]);
    await user.click(screen.getByRole("button", { name: "Check exact result" }));
    await screen.findByText(/The action was saved/);
    expect(cache.getQueryData(recoveryKey())).toEqual([]);
    expect(vi.mocked(confirmDiningCommand).mock.calls).toEqual(Array.from({ length: 3 }, () => ["school", commandId, "session-1"]));
    expect(actOnDiningSession).toHaveBeenCalledTimes(2);
  });

  it("clears a retained uncertain intent only when its exact receipt is terminally refused", async () => {
    const cache = client(), user = userEvent.setup();
    vi.mocked(actOnDiningSession).mockRejectedValue(new TypeError("Response lost"));
    vi.mocked(confirmDiningCommand).mockResolvedValue({ state: "not_accepted" });
    const view = render(wrapper(cache, dialog())); await submit();
    await screen.findByRole("button", { name: "Check result" });
    const commandId = vi.mocked(actOnDiningSession).mock.calls[0]![2].command_id;
    view.unmount(); render(wrapper(cache, null));
    await user.click(await screen.findByRole("button", { name: "Check exact result" }));
    await screen.findByText(/The action was not accepted/);
    expect(confirmDiningCommand).toHaveBeenCalledWith("school", commandId, "session-1");
    expect(cache.getQueryData(recoveryKey())).toEqual([]);
    expect(actOnDiningSession).toHaveBeenCalledOnce();
  });

  it("does not release an uncertain reference for another source's accepted receipt", async () => {
    const cache = client(), user = userEvent.setup();
    vi.mocked(actOnDiningSession).mockRejectedValue(new TypeError("Response lost"));
    vi.mocked(confirmDiningCommand).mockResolvedValue({ state: "accepted", result: { ...accepted, id: "another-session" } });
    const view = render(wrapper(cache, dialog())); await submit();
    await screen.findByRole("button", { name: "Check result" }); view.unmount(); render(wrapper(cache, null));
    await user.click(await screen.findByRole("button", { name: "Check exact result" }));
    await screen.findByText(/This receipt belongs to another action/);
    expect(cache.getQueryData(recoveryKey())).toEqual([expect.objectContaining({ sourceId: "session-1", phase: "unknown", detached: true })]);
    expect(actOnDiningSession).toHaveBeenCalledOnce();
  });

  it("keeps known acceptance through failed readback and retries only refresh after remount", async () => {
    const cache = client(), user = userEvent.setup(), refresh = vi.fn().mockRejectedValue(new Error("Read failed"));
    const read = vi.fn().mockResolvedValue("Current view");
    function Readback() { const query = useQuery({ queryKey: executionEnvironmentQueryKey(live, ["dining", "school", "actor", "session", "session-1"]), queryFn: read }); return <p>{query.data}</p>; }
    vi.mocked(actOnDiningSession).mockResolvedValue(accepted);
    const view = render(wrapper(cache, dialog(refresh))); await submit();
    await screen.findByRole("button", { name: "Refresh saved record" }); view.unmount();
    const mounted = render(wrapper(cache, <Readback />)); await screen.findByText("Current view");
    read.mockRejectedValueOnce(new ApiError("Temporary read failure", 500));
    await user.click(screen.getByRole("button", { name: "Refresh saved record" }));
    await screen.findByText("Saved. The updated view could not be loaded. Refresh the saved record.");
    expect(cache.getQueryData(recoveryKey())).toEqual([expect.objectContaining({ phase: "accepted", detached: true })]);
    mounted.unmount(); render(wrapper(cache, <Readback />));
    await user.click(await screen.findByRole("button", { name: "Refresh saved record" }));
    await screen.findByText(/The action was saved/);
    expect(cache.getQueryData(recoveryKey())).toEqual([]);
    expect(actOnDiningSession).toHaveBeenCalledOnce(); expect(confirmDiningCommand).not.toHaveBeenCalled();
  });

  it("partitions references by school, actor and run, and ignores another scope's late acceptance UI", async () => {
    const cache = client(), user = userEvent.setup(), lookup = deferred<DiningConfirmation>();
    vi.mocked(actOnDiningSession).mockRejectedValue(new TypeError("Response lost"));
    vi.mocked(confirmDiningCommand).mockReturnValue(lookup.promise);
    const view = render(wrapper(cache, dialog(), run("run-a"))); await submit();
    await screen.findByRole("button", { name: "Check result" }); view.rerender(wrapper(cache, null, run("run-a")));
    await user.click(await screen.findByRole("button", { name: "Check exact result" }));
    const invalidation = vi.spyOn(cache, "invalidateQueries");
    for (const [environment, actorId, schoolId] of [[run("run-b"), "actor", "school"], [run("run-a"), "other-actor", "school"], [run("run-a"), "actor", "other-school"], [live, "actor", "school"]] as const) {
      view.rerender(wrapper(cache, null, environment, actorId, schoolId));
      expect(screen.queryByRole("region", { name: "Retained Dining action" })).not.toBeInTheDocument();
      expect(cache.getQueryData(recoveryKey(environment, actorId, schoolId))).toBeUndefined();
    }
    await act(async () => { lookup.resolve({ state: "accepted", result: accepted }); await lookup.promise; });
    expect(screen.queryByText(/The action was saved/)).not.toBeInTheDocument();
    expect(invalidation).not.toHaveBeenCalled();
    expect(cache.getQueryData(recoveryKey(run("run-a")))).toEqual([expect.objectContaining({ phase: "accepted", detached: true })]);
    view.rerender(wrapper(cache, null, run("run-a")));
    expect(await screen.findByRole("button", { name: "Refresh saved record" })).toBeEnabled();
    expect(actOnDiningSession).toHaveBeenCalledOnce();
  });

  it("detaches a pending command into its original scope, not a replacement actor", async () => {
    const cache = client(), user = userEvent.setup(), outcome = deferred<DiningAccepted>(), onAccepted = vi.fn().mockResolvedValue(undefined);
    function Command() {
      const write = useDiningCommand({ schoolId: "school", sourceId: "session-1", kind: "session", onAccepted });
      return <><button type="button" onClick={() => void write.execute(() => outcome.promise, { id: "session-1", revision: 2 })}>Start action</button><DiningWriteFeedback write={write} /></>;
    }
    const view = render(wrapper(cache, <Command />)); await user.click(screen.getByRole("button", { name: "Start action" }));
    const retained = cache.getQueryData<unknown[]>(recoveryKey()); expect(retained).toHaveLength(1);
    view.rerender(wrapper(cache, null, live, "next-actor"));
    await act(async () => { outcome.resolve(accepted); await outcome.promise; });
    expect(onAccepted).not.toHaveBeenCalled();
    expect(cache.getQueryData(recoveryKey(live, "next-actor"))).toBeUndefined();
    expect(cache.getQueryData(recoveryKey())).toEqual([expect.objectContaining({ phase: "accepted", detached: true })]);
    expect(screen.queryByRole("button", { name: "Check exact result" })).not.toBeInTheDocument();
  });
});
