import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getCampusSceneImage } from "./api";
import { useSceneImageUrl } from "./useSceneImageUrl";
vi.mock("./api", () => ({ getCampusSceneImage: vi.fn() }));
const urls = { create: vi.fn(() => "blob:private-campus-source"), revoke: vi.fn() };
beforeEach(() => { vi.clearAllMocks(); vi.spyOn(URL, "createObjectURL").mockImplementation(urls.create); vi.spyOn(URL, "revokeObjectURL").mockImplementation(urls.revoke); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe("private campus image lifecycle", () => {
  it("ignores a late image from the previous world and releases the current URL on unmount", async () => {
    let finishLive!: (value: Blob) => void; let finishRun!: (value: Blob) => void;
    vi.mocked(getCampusSceneImage).mockImplementationOnce(() => new Promise(resolve => { finishLive = resolve; })).mockImplementationOnce(() => new Promise(resolve => { finishRun = resolve; }));
    const hook = renderHook(({ world }) => useSceneImageUrl("school", "campus", "source", world), { initialProps: { world: "live:global" } });
    expect(hook.result.current.loading).toBe(true);
    hook.rerender({ world: "simulation:run:run" });
    expect(vi.mocked(getCampusSceneImage).mock.calls[0]?.[3]?.aborted).toBe(true);
    await act(async () => { finishLive(new Blob(["live source"])); await Promise.resolve(); });
    expect(urls.create).not.toHaveBeenCalled();
    await act(async () => { finishRun(new Blob(["run source"])); await Promise.resolve(); });
    expect(hook.result.current.url).toBe("blob:private-campus-source");
    hook.unmount(); expect(urls.revoke).toHaveBeenCalledExactlyOnceWith("blob:private-campus-source");
  });
  it("removes the private preview immediately when the draft no longer references it", async () => {
    vi.mocked(getCampusSceneImage).mockResolvedValue(new Blob(["image"]));
    const hook = renderHook(({ imageId }: { imageId: string | undefined }) => useSceneImageUrl("school", "campus", imageId, "live:global"), { initialProps: { imageId: "source" } });
    await waitFor(() => expect(hook.result.current.url).toBe("blob:private-campus-source"));
    hook.rerender({ imageId: undefined });
    expect(hook.result.current.url).toBeUndefined();
    expect(hook.result.current.loading).toBe(false);
    expect(urls.revoke).toHaveBeenCalledWith("blob:private-campus-source");
  });
});
