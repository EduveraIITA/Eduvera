import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../lib/api";
import { CarePendingReceipts } from "./CarePendingReceipts";
import { confirmCareCommand, type CareReceipt } from "./api";
import { careRecoveryKey, useCareSave } from "./useCareSave";

vi.mock("./api", () => ({ confirmCareCommand: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const scope = ["care-test", "live", "actor-A"] as const;
const commandId = "pending-command", caseId = "pending-case";
const reference = { commandId, caseId, slot: "intake", phase: "unknown" as const, everUncertain: true };
const accepted: CareReceipt = { id: caseId, revision: 1, receipt_id: "native-receipt", receipt: "Recorded" };
const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

describe("protected detached confirmation", () => {
  it("releases a matching not-accepted terminal result instead of claiming it is still pending", async () => {
    const cache = client(); cache.setQueryData(careRecoveryKey(scope), [reference]);
    vi.mocked(confirmCareCommand).mockResolvedValue({ state: "not_accepted" });
    render(<QueryClientProvider client={cache}><CarePendingReceipts schoolId="school" scope={scope} /></QueryClientProvider>);
    await userEvent.setup().click(screen.getByRole("button", { name: "Check exact result" }));
    expect(await screen.findByText(/This exact save was not accepted/)).toBeVisible();
    expect(cache.getQueryData(careRecoveryKey(scope))).toEqual([]);
  });

  it("keeps accepted confirmation through readback failure and retries only that read", async () => {
    const cache = client(); cache.setQueryData(careRecoveryKey(scope), [reference]);
    vi.mocked(confirmCareCommand).mockResolvedValue({ state: "accepted", result: accepted });
    const refresh = vi.fn<() => Promise<void>>().mockRejectedValueOnce(new Error("Temporary refresh failure")).mockResolvedValue(undefined);
    render(<QueryClientProvider client={cache}><CarePendingReceipts schoolId="school" scope={scope} onConfirmed={refresh} /></QueryClientProvider>);
    const user = userEvent.setup(); await user.click(screen.getByRole("button", { name: "Check exact result" }));
    expect(await screen.findByText("Temporary refresh failure")).toBeVisible();
    expect(cache.getQueryData(careRecoveryKey(scope))).toMatchObject([{ phase: "accepted", result: { receipt_id: accepted.receipt_id } }]);
    await user.click(screen.getByRole("button", { name: "Refresh saved record" }));
    expect(await screen.findByText(/Saved. Current access/)).toBeVisible();
    expect(confirmCareCommand).toHaveBeenCalledOnce(); expect(refresh).toHaveBeenCalledTimes(2);
    expect(cache.getQueryData(careRecoveryKey(scope))).toEqual([]);
  });

  it("ignores a late confirmation after actor/world scope changes", async () => {
    const cache = client(); cache.setQueryData(careRecoveryKey(scope), [reference]);
    let resolve!: (value: Awaited<ReturnType<typeof confirmCareCommand>>) => void;
    vi.mocked(confirmCareCommand).mockImplementation(() => new Promise(done => { resolve = done; }));
    const mount = (selected: readonly unknown[]) => <QueryClientProvider client={cache}><CarePendingReceipts key={JSON.stringify(selected)} schoolId="school" scope={selected} /></QueryClientProvider>;
    const view = render(mount(scope)); await userEvent.setup().click(screen.getByRole("button", { name: "Check exact result" }));
    const other = ["care-test", "simulation:other-world", "actor-B"];
    view.rerender(mount(other));
    await act(async () => { resolve({ state: "accepted", result: accepted }); await Promise.resolve(); });
    expect(screen.queryByText(/Saved. Current access/)).not.toBeInTheDocument();
    expect(cache.getQueryData(careRecoveryKey(scope))).toEqual([reference]);
    expect(cache.getQueryData(careRecoveryKey(other))).toEqual([]);
  });

  it("forgets the exact private callable after detached acceptance; a stale reference cannot resend it", async () => {
    const cache = client(), operation = vi.fn<() => Promise<CareReceipt>>().mockRejectedValue(new TypeError("Response lost"));
    function Editor() {
      const save = useCareSave({ schoolId: "school", scope, slot: "intake", onAccepted: () => undefined });
      return <><button type="button" onClick={() => void save.execute(operation)}>Send protected draft</button>{save.recovery && <button type="button" onClick={() => void save.recover()}>{save.retryReady ? "Retry exact save" : "Check editor result"}</button>}{save.error && <p role="status">{save.error}</p>}</>;
    }
    function Harness() { const [editor, setEditor] = useState(true); return <><button type="button" onClick={() => setEditor(value => !value)}>Switch surface</button>{editor ? <Editor /> : <CarePendingReceipts schoolId="school" scope={scope} />}</>; }
    render(<QueryClientProvider client={cache}><MemoryRouter><Harness /></MemoryRouter></QueryClientProvider>);
    const user = userEvent.setup(); await user.click(screen.getByRole("button", { name: "Send protected draft" }));
    await screen.findByText(/Save not confirmed/);
    const refs = cache.getQueryData<Array<typeof reference>>(careRecoveryKey(scope))!, exact = refs[0]!;
    vi.mocked(confirmCareCommand).mockResolvedValue({ state: "accepted", result: { ...accepted, id: exact.caseId } });
    await user.click(screen.getByRole("button", { name: "Switch surface" })); await user.click(screen.getByRole("button", { name: "Check exact result" }));
    await screen.findByText(/Saved. Current access/); expect(cache.getQueryData(careRecoveryKey(scope))).toEqual([]);
    cache.setQueryData(careRecoveryKey(scope), [exact]); vi.mocked(confirmCareCommand).mockResolvedValue({ state: "not_found" });
    await user.click(screen.getByRole("button", { name: "Switch surface" })); await user.click(screen.getByRole("button", { name: "Check editor result" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Retry exact save" })).not.toBeInTheDocument());
    expect(operation).toHaveBeenCalledOnce();
  });

  it("keeps an exact uncertain reference when confirmation itself loses authority", async () => {
    const cache = client(); cache.setQueryData(careRecoveryKey(scope), [reference]);
    vi.mocked(confirmCareCommand).mockRejectedValue(new ApiError("Access changed", 403));
    render(<QueryClientProvider client={cache}><CarePendingReceipts schoolId="school" scope={scope} /></QueryClientProvider>);
    await userEvent.setup().click(screen.getByRole("button", { name: "Check exact result" }));
    expect(await screen.findByText("Access changed")).toBeVisible(); expect(cache.getQueryData(careRecoveryKey(scope))).toEqual([reference]);
  });
});
