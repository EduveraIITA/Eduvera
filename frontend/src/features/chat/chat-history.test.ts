import { InfiniteQueryObserver, QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createChatHistoryReader, ChatHistoryRefreshLimitError } from "./chat-history";
import { getChatMessages, type ChatMessage, type ChatMessagePage } from "./api";

vi.mock("./api", () => ({ getChatMessages: vi.fn() }));
afterEach(() => vi.clearAllMocks());

function fixture() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let rows = Array.from({ length: 120 }, (_, i) => ({ id: String(i + 1), body: `Message ${i + 1}` } as ChatMessage));
  const key = ["chat", "messages", "thread", "history", "account-a:live:school-a"];
  vi.mocked(getChatMessages).mockImplementation((_id, cursor, options) => {
    const eligible = rows.filter(row => !cursor || Number(row.id) < Number(cursor)).reverse();
    const native = eligible.slice(0, 51);
    const through = options?.throughCursor;
    const crossing = through ? native.findIndex(row => Number(row.id) <= Number(through)) : -1;
    const equal = crossing >= 0 && native[crossing]?.id === through;
    const reached = Boolean(through && ((crossing >= 0 && (crossing < 50 || !equal)) || native.length <= 50));
    const results = native.slice(0, reached && crossing >= 0 ? crossing + Number(equal) : 50).reverse();
    const boundary = reached ? through : results[0]?.id ?? null;
    const hasMore = reached ? crossing >= 0 && (!equal || native.length > crossing + 1) : native.length > 50;
    return Promise.resolve({ results, has_more: hasMore, next_cursor: hasMore ? boundary : null, boundary_cursor: boundary, reached_through: reached });
  });
  const observer = new InfiniteQueryObserver(client, {
    queryKey: key, enabled: false, initialPageParam: undefined as string | undefined,
    queryFn: createChatHistoryReader(client, key, "thread"),
    getNextPageParam: (page: ChatMessagePage) => page.has_more ? page.next_cursor ?? undefined : undefined,
  });
  const unsubscribe = observer.subscribe(() => {});
  return { client, observer, key, get rows() { return rows; }, set rows(value) { rows = value; }, close: () => { unsubscribe(); client.clear(); } };
}

const ids = (observer: ReturnType<typeof fixture>["observer"]) => observer.getCurrentResult().data?.pages.flatMap(page => page.results.map(row => row.id)).sort((a, b) => Number(a) - Number(b));

describe("authoritative anchored chat history", () => {
  it("retains 21–120 after new head 121 and repeated send/invalidation-style refetches, while refreshing edits and removals", async () => {
    const f = fixture();
    try {
      await f.observer.refetch(); await f.observer.fetchNextPage();
      expect(ids(f.observer)).toEqual(Array.from({ length: 100 }, (_, i) => String(i + 21)));
      f.rows.push({ id: "121", body: "New sent message" } as ChatMessage);
      f.rows = f.rows.filter(row => row.id !== "71").map(row => row.id === "21" ? { ...row, body: "Edited authoritative body" } : row);
      await f.observer.refetch();
      expect(ids(f.observer)).toEqual(Array.from({ length: 101 }, (_, i) => String(i + 21)).filter(id => id !== "71"));
      expect(f.observer.getCurrentResult().data?.pages.flatMap(page => page.results).find(row => row.id === "21")?.body).toBe("Edited authoritative body");
      f.rows.push({ id: "122", body: "Second sent message" } as ChatMessage);
      await f.observer.refetch();
      expect(ids(f.observer)).toContain("21"); expect(ids(f.observer)).toContain("122");
      expect(ids(f.observer)).not.toContain("71");
    } finally { f.close(); }
  });

  it("bounds a refresh transaction and keeps the previous verified view until an explicit rebase", async () => {
    const f = fixture();
    try {
      await f.observer.refetch(); await f.observer.fetchNextPage();
      const before = ids(f.observer);
      f.rows.push(...Array.from({ length: 1_100 }, (_, i) => ({ id: String(i + 121), body: "New traffic" } as ChatMessage)));
      vi.mocked(getChatMessages).mockClear();
      await f.observer.refetch();
      expect(f.observer.getCurrentResult().error).toBeInstanceOf(ChatHistoryRefreshLimitError);
      expect(getChatMessages).toHaveBeenCalledTimes(20);
      expect(ids(f.observer)).toEqual(before);
      await f.client.resetQueries({ queryKey: f.key, exact: true });
      await f.observer.refetch();
      expect(ids(f.observer)).toHaveLength(50); expect(ids(f.observer)?.at(-1)).toBe("1220");
    } finally { f.close(); }
  });

  it("never borrows another account/world/conversation's retained frontier", async () => {
    const f = fixture();
    try {
      await f.observer.refetch(); await f.observer.fetchNextPage();
      vi.mocked(getChatMessages).mockClear();
      for (const scope of ["account-b:live:school-a", "account-a:simulation:run-b", "account-a:live:child-b"]) {
        const read = createChatHistoryReader(f.client, ["chat", "messages", "different-thread", "history", scope], "different-thread");
        const page = await read({ pageParam: undefined, signal: new AbortController().signal });
        expect(page.results).toHaveLength(50);
        expect(getChatMessages).toHaveBeenLastCalledWith("different-thread", undefined, expect.objectContaining({ throughCursor: undefined }));
      }
    } finally { f.close(); }
  });
});
