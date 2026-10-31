import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FacilitiesArtifactStore, REPAIR_PHOTO_LIMIT, repairPhotoMetadata } from "../src/facilities/facilities-artifacts.js";

const mock = vi.hoisted(() => ({ bytes: new Map<string, Buffer>(), omitted: false }));
vi.mock("../src/config.js", () => ({ config: () => ({ uploadDir: "/unused-facilities-test" }) }));
vi.mock("../src/common/environment-files.js", () => ({
  mkdir: vi.fn(),
  writeFile: (path: string, bytes: Buffer) => {
    if (mock.bytes.has(path)) throw new Error("already exists");
    mock.bytes.set(path, Buffer.from(bytes));
    return Promise.resolve();
  },
  readEnvironmentStoredFile: (path: string, type: string, name: string) => Promise.resolve({
    stream: Readable.from([mock.bytes.get(path) ?? Buffer.from("placeholder")]),
    content_type: type, original_name: name, source_content_omitted: mock.omitted,
    size_bytes: null, evidence_mode: mock.omitted ? "simulation" : "live",
  }),
}));

const ids = ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "cccccccc-cccc-4ccc-8ccc-cccccccccccc"] as const;
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
beforeEach(() => { mock.bytes.clear(); mock.omitted = false; });

describe("protected Facilities photo bytes", () => {
  it("validates type/signature/limits and sanitizes download names", () => {
    expect(repairPhotoMetadata({ filename: "C:\\private\\leak\r\n.png", mimetype: "image/png", data: png }))
      .toMatchObject({ original_name: "leak__.png", content_type: "image/png", size_bytes: 8 });
    for (const upload of [
      { filename: "fake.png", mimetype: "image/png", data: Buffer.from("<svg/>") },
      { filename: "image.html", mimetype: "text/html", data: png },
      { filename: "empty.png", mimetype: "image/png", data: Buffer.alloc(0) },
      { filename: "large.png", mimetype: "image/png", data: Buffer.alloc(REPAIR_PHOTO_LIMIT + 1) },
    ]) expect(() => repairPhotoMetadata(upload)).toThrow();
  });
  it("reuses exact immutable writes but refuses changed bytes or invalid identities", async () => {
    const store = new FacilitiesArtifactStore();
    await store.put(...ids, png, "image/png");
    await expect(store.put(...ids, png, "image/png")).resolves.toBeUndefined();
    await expect(store.put(...ids, Buffer.from("changed"), "image/png")).rejects.toThrow("already exists");
    await expect(store.put(ids[0], "../another-room", ids[2], png, "image/png")).rejects.toThrow();
    expect(mock.bytes.size).toBe(1);
  });
  it("checks accepted size/hash and retains omitted-source status instead of treating it as evidence", async () => {
    const store = new FacilitiesArtifactStore();
    await store.put(...ids, png, "image/png");
    const hash = createHash("sha256").update(png).digest("hex");
    expect(await store.read(...ids, "image/png", "leak.png", png.length, hash)).toMatchObject({ source_content_omitted: false, size_bytes: 8 });
    await expect(store.read(...ids, "image/png", "leak.png", 7, hash)).rejects.toThrow("integrity");
    await expect(store.read(...ids, "image/png", "leak.png", png.length, "wrong")).rejects.toThrow("integrity");
    mock.omitted = true;
    expect(await store.read(...ids, "image/png", "leak.png", png.length, hash)).toMatchObject({ source_content_omitted: true });
    await expect(store.put(...ids, png, "image/png")).rejects.toThrow("already exists");
  });
});
