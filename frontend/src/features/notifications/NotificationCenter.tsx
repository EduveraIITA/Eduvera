import { type InfiniteData, useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, BookOpen, CalendarCheck2, Check, ClipboardCheck, LoaderCircle } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { useOptionalAuth } from "../auth/AuthContext";
import { apiFetch } from "../../lib/api";
import "./notifications.css";

type NotificationKind = "attendance" | "leave" | "diary" | "general";

interface SchoolNotification {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  link: string;
  metadata?: Record<string, unknown>;
  attention_eligible: boolean;
  read_at: string | null;
  created_at: string;
}

interface NotificationPage {
  results: SchoolNotification[];
  unread_count: number;
  next_cursor: string | null;
}

interface NotificationCenterProps {
  buttonClassName: string;
  iconSize?: number;
  fallbackUnreadCount?: number;
  onOpen?: () => void;
}

function formatWhen(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently";
  const elapsedMinutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60_000));
  if (elapsedMinutes < 1) return "Just now";
  if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`;
  if (elapsedMinutes < 24 * 60) return `${Math.floor(elapsedMinutes / 60)}h ago`;
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short" }).format(date);
}

function KindIcon({ kind }: { kind: NotificationKind }) {
  if (kind === "attendance") return <ClipboardCheck size={17} />;
  if (kind === "leave") return <CalendarCheck2 size={17} />;
  if (kind === "diary") return <BookOpen size={17} />;
  return <Bell size={17} />;
}

export function NotificationCenter({
  buttonClassName,
  iconSize = 20,
  fallbackUnreadCount,
  onOpen,
}: NotificationCenterProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const auth = useOptionalAuth();
  const authUserId = auth?.user?.id ?? "anonymous";
  const notificationsQueryKey = ["notifications", authUserId] as const;
  const anchor = useRef<HTMLDivElement>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const routeOpen = new URLSearchParams(location.search).get("notifications") === "open";
  const open = panelOpen || routeOpen;
  const setOpen = useCallback((value: boolean) => {
    setPanelOpen(value);
    const params = new URLSearchParams(location.search);
    if (params.get("notifications") !== "open") return;
    params.delete("notifications");
    void navigate({ pathname: location.pathname, search: params.toString(), hash: location.hash }, { replace: true });
  }, [location.hash, location.pathname, location.search, navigate]);
  const query = useInfiniteQuery({
    queryKey: notificationsQueryKey,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: "50" });
      if (pageParam) params.set("cursor", pageParam);
      return apiFetch<NotificationPage>(`/api/v1/notifications/?${params}`);
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.next_cursor ?? undefined,
    enabled: auth?.status === "authenticated",
    staleTime: 20_000,
  });
  const readMutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ id: string; read_at: string }>(`/api/v1/notifications/${id}/read/`, {
        method: "POST",
      }),
    onSuccess: (_result, id) => {
      queryClient.setQueryData<InfiniteData<NotificationPage, string | undefined>>(notificationsQueryKey, (current) => {
        if (!current) return current;
        const wasUnread = current.pages.some((page) => page.results.some((item) => item.id === id && !item.read_at));
        return {
          ...current,
          pages: current.pages.map((page) => ({
            ...page,
            unread_count: Math.max(0, page.unread_count - (wasUnread ? 1 : 0)),
            results: page.results.map((item) =>
              item.id === id ? { ...item, read_at: new Date().toISOString() } : item,
            ),
          })),
        };
      });
      void queryClient.invalidateQueries({ queryKey: ["attention"] });
    },
  });

  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: PointerEvent) => {
      if (!anchor.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open, setOpen]);

  const items = query.data?.pages.flatMap((page) => page.results) ?? [];
  const unreadCount = query.data?.pages[0]?.unread_count ?? fallbackUnreadCount ?? 0;

  async function openNotification(item: SchoolNotification) {
    if (item.link.startsWith("/") && !item.link.startsWith("//")) {
      const studentId = item.metadata?.student_id;
      const destination = new URL(item.link, window.location.origin);
      if (
        typeof studentId === "string" &&
        !destination.searchParams.has("student_id") &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(studentId)
      ) {
        destination.searchParams.set("student_id", studentId);
      }
      if (item.attention_eligible) {
        // Typed informational attention is acknowledged by the destination
        // screen only after that screen has mounted successfully.
        destination.searchParams.set("attention_notification_id", item.id);
      } else if (!item.read_at) {
        await readMutation.mutateAsync(item.id);
      }
      setOpen(false);
      void navigate(`${destination.pathname}${destination.search}${destination.hash}`);
    }
  }

  return (
    <div className="notification-center" ref={anchor}>
      <button
        className={buttonClassName}
        type="button"
        aria-label={unreadCount ? `Notifications, ${unreadCount} unread` : "Notifications"}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          onOpen?.();
          if (!open && auth?.status === "authenticated") void query.refetch();
          setOpen(!open);
        }}
      >
        <Bell size={iconSize} />
        {unreadCount > 0 ? <span className="notification-center__dot" aria-hidden="true">{unreadCount > 99 ? "99+" : unreadCount}</span> : null}
      </button>

      {open ? (
        <section className="notification-panel" role="dialog" aria-label="Notifications">
          <header>
            <span><strong>Notifications</strong><small>{unreadCount ? `${unreadCount} unread` : "You're all caught up"}</small></span>
            {query.isFetching ? <LoaderCircle className="notification-spin" size={16} /> : <Check size={16} />}
          </header>
          {query.isPending ? (
            <div className="notification-panel__state"><LoaderCircle className="notification-spin" size={18} /><span>Loading school updates...</span></div>
          ) : query.isError ? (
            <div className="notification-panel__state notification-panel__state--error">
              <span>Updates could not be loaded.</span>
              <button type="button" onClick={() => void query.refetch()}>Try again</button>
            </div>
          ) : items.length === 0 ? (
            <div className="notification-panel__state"><Check size={19} /><span>No new school updates.</span></div>
          ) : (
            <div className="notification-panel__list">
              {items.map((item) => (
                <button
                  key={item.id}
                  className={`notification-panel__item ${item.read_at ? "is-read" : "is-unread"}`}
                  type="button"
                  disabled={readMutation.isPending && readMutation.variables === item.id}
                  onClick={() => void openNotification(item)}
                >
                  <span className={`notification-panel__icon notification-panel__icon--${item.kind}`}><KindIcon kind={item.kind} /></span>
                  <span><strong>{item.title}</strong><small>{item.body}</small><time>{formatWhen(item.created_at)}</time></span>
                  {!item.read_at ? <i aria-label="Unread" /> : null}
                </button>
              ))}
              {query.hasNextPage ? (
                <button
                  className={`notification-panel__more${query.isFetchNextPageError ? " notification-panel__more--error" : ""}`}
                  type="button"
                  disabled={query.isFetchingNextPage}
                  onClick={() => void query.fetchNextPage()}
                >
                  {query.isFetchingNextPage ? <LoaderCircle className="notification-spin" size={15} /> : null}
                  {query.isFetchingNextPage ? "Loading earlier updates…"
                    : query.isFetchNextPageError ? "Try loading earlier updates again" : "Earlier updates"}
                </button>
              ) : null}
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
