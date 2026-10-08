import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../../lib/api";
import { ClassLoadState } from "./classWorkspace";
import { useClassUpdates } from "./classUpdates";

export function ClassNotes({ classId, date }: { classId: string; date: string }) {
  const updates = useClassUpdates(date);
  const client = useQueryClient();
  const read = useMutation({ mutationFn: (id: string) => apiFetch(`/api/v1/notifications/${id}/read/`, { method: "POST" }), onSuccess: async () => {
    await Promise.all([client.invalidateQueries({ queryKey: ["teacher-class-updates"] }), client.invalidateQueries({ queryKey: ["notifications"] })]);
  } });
  if (updates.isPending) return <ClassLoadState loading label="Loading class updates" />;
  if (updates.error) return <ClassLoadState label="Could not load class updates." retry={() => void updates.refetch()} />;
  const items = updates.data.results.filter(item => item.class_section_id === classId);
  return <section aria-label="Recent class updates">
    <p className="classes-caption">Last two weeks · notes, comments sent to you and class updates</p>
    {read.error ? <p role="alert">Could not mark this update as read. Try again.</p> : null}
    {items.length ? <div className="classes-group">{items.map(item => <article className="classes-note" key={`${item.kind}:${item.id}`}>
      <p className="classes-caption">{item.kind === "comment" ? "Private comment" : item.kind === "change" ? "Class update" : "Class note"} · {new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" }).format(new Date(item.occurred_at))}{item.unread ? " · Unread" : ""}</p>
      <h2>{item.title}</h2><p className="classes-note__body">{item.body}</p>
      {item.unread && item.notification_id ? <button className="classes-read" disabled={read.isPending} onClick={() => read.mutate(item.notification_id!)}>Mark as read</button> : null}
    </article>)}</div> : <p className="classes-empty">No class updates in this period.</p>}
    {(items[0]?.total ?? 0) > items.length ? <p className="classes-caption">Showing the latest {items.length} of {items[0]?.total} updates.</p> : null}
  </section>;
}
