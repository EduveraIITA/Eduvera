import { afterEach, describe, expect, it, vi } from "vitest";
import { readPeopleXlsx } from "./readPeopleXlsx";

class TestWorker {
  static current: TestWorker;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminate = vi.fn();
  postMessage = vi.fn();
  constructor(public url: URL, public options: WorkerOptions) { TestWorker.current = this; }
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("isolated Excel reader", () => {
  it("loads a same-origin static worker, returns sheets and terminates", async () => {
    vi.stubGlobal("Worker", TestWorker);
    const buffer = new ArrayBuffer(1), promise = readPeopleXlsx(buffer);
    const worker = TestWorker.current;
    expect(worker.url.pathname).toMatch(/peopleXlsx.worker.ts$/);
    expect(worker.options).toEqual({ type: "module" });
    expect(worker.postMessage).toHaveBeenCalledWith(buffer, [buffer]);
    const sheets = [{ name: "People", rows: [["Name"], ["QA Person"]] }];
    worker.onmessage?.({ data: { sheets } });
    await expect(promise).resolves.toEqual(sheets);
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
  it("fails visibly and terminates on a parser error", async () => {
    vi.stubGlobal("Worker", TestWorker);
    const promise = readPeopleXlsx(new ArrayBuffer(1));
    TestWorker.current.onmessage?.({ data: { error: "Workbook too large" } });
    await expect(promise).rejects.toThrow("Workbook too large");
    expect(TestWorker.current.terminate).toHaveBeenCalledOnce();
  });
  it("terminates stalled parsing with a recoverable timeout", async () => {
    vi.useFakeTimers(); vi.stubGlobal("Worker", TestWorker);
    const promise = readPeopleXlsx(new ArrayBuffer(1));
    const check = expect(promise).rejects.toThrow(/too long/);
    await vi.advanceTimersByTimeAsync(15_000);
    await check;
    expect(TestWorker.current.terminate).toHaveBeenCalledOnce();
  });
  it("does not fall back to blocking parsing when workers are unavailable", async () => {
    vi.stubGlobal("Worker", undefined);
    await expect(readPeopleXlsx(new ArrayBuffer(1))).rejects.toThrow(/Use CSV or paste/);
  });
});
