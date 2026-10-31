import type { InfiniteData, QueryClient, QueryKey } from "@tanstack/react-query";
import { getChatMessages, type ChatMessagePage } from "./api";

export class ChatHistoryRefreshLimitError extends Error {
  constructor() {
    super("Your loaded history needs a fresh start. The last verified messages are still shown.");
    this.name = "ChatHistoryRefreshLimitError";
  }
}

/** Each fetch cycle is transactional in InfiniteQuery. Re-cover every displayed
 * frontier from authoritative reads instead of sliding a fixed page count from
 * the new head. Never merge stale message bodies back into refreshed results.
 * A finite cycle budget prevents a busy thread or deep history from polling
 * indefinitely; the operator can explicitly rebase to recent messages. */
export function createChatHistoryReader(client: QueryClient, key: QueryKey, conversationId: string) {
  const budgets = new WeakMap<AbortSignal, number>();
  return async ({ pageParam, signal }: { pageParam: string | undefined; signal: AbortSignal }): Promise<ChatMessagePage> => {
    const previous = client.getQueryData<InfiniteData<ChatMessagePage, string | undefined>>(key);
    const previousIndex = previous?.pageParams.findIndex((value) => value === pageParam) ?? -1;
    const throughCursor = previousIndex >= 0 ? previous?.pages[previousIndex]?.boundary_cursor ?? undefined : undefined;
    let cursor = pageParam;
    const newestFirstPages: ChatMessagePage[] = [];
    for (;;) {
      signal.throwIfAborted();
      const requests = budgets.get(signal) ?? 0;
      if (requests >= 20) throw new ChatHistoryRefreshLimitError();
      budgets.set(signal, requests + 1);
      const page = await getChatMessages(conversationId, cursor, { throughCursor, signal });
      newestFirstPages.push(page);
      if (!throughCursor || page.reached_through) {
        return { ...page, results: newestFirstPages.reverse().flatMap((item) => item.results) };
      }
      if (!page.has_more || !page.next_cursor || page.next_cursor === cursor) throw new ChatHistoryRefreshLimitError();
      cursor = page.next_cursor;
    }
  };
}
