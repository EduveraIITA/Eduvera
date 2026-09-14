import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  CheckCheck,
  FileText,
  Flag,
  LoaderCircle,
  MessageCircle,
  Paperclip,
  Search,
  Send,
  Trash2,
  UserRoundPlus,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { useOptionalAuth, type Portal } from "../auth/AuthContext";
import { getAccessibleStudents } from "../school/api";
import { ParentShell } from "../../pages/parent/ParentShell";
import { StudentShell } from "../../pages/student/StudentShell";
import { OperationsShell } from "../../pages/operations/OperationsShell";
import {
  createChatConversation,
  deleteChatMessage,
  getChatConversations,
  getChatMessages,
  getChatRecipients,
  markChatRead,
  reportChatMessage,
  sendChatMessage,
  type ChatMessage,
  type ChatRecipient,
} from "./api";
import "./chat.css";

function initials(name: string) {
  return name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

function relativeTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const minutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60_000));
  if (minutes < 1) return "Now";
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1_440) return `${Math.floor(minutes / 60)}h`;
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short" }).format(date);
}

function messageTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit" }).format(date);
}

function RecipientPicker({
  recipients,
  pending,
  onClose,
  onChoose,
}: {
  recipients: ChatRecipient[];
  pending: boolean;
  onClose: () => void;
  onChoose: (recipient: ChatRecipient) => void;
}) {
  const [search, setSearch] = useState("");
  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return term
      ? recipients.filter((item) => `${item.name} ${item.detail} ${item.school_name}`.toLowerCase().includes(term))
      : recipients;
  }, [recipients, search]);

  return (
    <div className="chat-picker-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="chat-picker" role="dialog" aria-modal="true" aria-labelledby="new-message-title">
        <header>
          <span><strong id="new-message-title">New message</strong><small>Only approved school contacts are shown</small></span>
          <button type="button" onClick={onClose} aria-label="Close"><X size={19} /></button>
        </header>
        <label className="chat-search">
          <Search size={17} />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search teachers or school staff" autoFocus />
        </label>
        <div className="chat-picker__list">
          {pending ? (
            <div className="chat-state"><LoaderCircle className="chat-spin" size={20} /><span>Finding your school contacts…</span></div>
          ) : visible.length ? visible.map((recipient) => (
            <button type="button" key={`${recipient.school_id}-${recipient.id}`} onClick={() => onChoose(recipient)}>
              <span className="chat-avatar">{recipient.avatar_url ? <img src={recipient.avatar_url} alt="" /> : initials(recipient.name)}</span>
              <span><strong>{recipient.name}</strong><small>{recipient.detail} · {recipient.school_name}</small></span>
              <MessageCircle size={18} />
            </button>
          )) : (
            <div className="chat-state"><UserRoundPlus size={21} /><span>No approved contacts match your search.</span></div>
          )}
        </div>
      </section>
    </div>
  );
}

function Bubble({
  message,
  onDelete,
  onReport,
}: {
  message: ChatMessage;
  onDelete: () => void;
  onReport: () => void;
}) {
  return (
    <article className={message.is_mine ? "chat-bubble is-mine" : "chat-bubble"}>
      {!message.is_mine ? <strong>{message.sender_name}</strong> : null}
      {message.is_deleted ? <p className="chat-bubble__deleted">This message was deleted.</p> : (
        <>
          {message.body ? <p>{message.body}</p> : null}
          {message.attachment ? (
            <a className="chat-attachment" href={message.attachment.file_url} target="_blank" rel="noreferrer">
              <FileText size={18} />
              <span><b>{message.attachment.original_name}</b><small>{Math.max(1, Math.round(message.attachment.size_bytes / 1024))} KB</small></span>
            </a>
          ) : null}
        </>
      )}
      <footer>
        <time>{messageTime(message.created_at)}</time>
        {message.is_mine ? <CheckCheck size={13} /> : null}
        {!message.is_deleted && message.is_mine ? (
          <button type="button" onClick={onDelete} aria-label="Delete message"><Trash2 size={12} /></button>
        ) : null}
        {!message.is_deleted && !message.is_mine ? (
          <button type="button" onClick={onReport} aria-label="Report message"><Flag size={12} /></button>
        ) : null}
      </footer>
    </article>
  );
}

function ChatExperience({ portal }: { portal: Portal }) {
  const auth = useOptionalAuth();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const selectedId = params.get("conversation") ?? "";
  const studentId = portal === "parent" ? params.get("student_id") ?? undefined : undefined;
  const [pickerOpen, setPickerOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [attachment, setAttachment] = useState<File>();
  const [search, setSearch] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const readRef = useRef("");

  const conversationsQuery = useQuery({
    queryKey: ["chat", "conversations"],
    queryFn: getChatConversations,
    refetchInterval: 10_000,
    staleTime: 5_000,
  });
  const recipientsQuery = useQuery({
    queryKey: ["chat", "recipients", studentId ?? "all"],
    queryFn: () => getChatRecipients(studentId),
    enabled: pickerOpen,
    staleTime: 60_000,
  });
  const messagesQuery = useQuery({
    queryKey: ["chat", "messages", selectedId],
    queryFn: () => getChatMessages(selectedId),
    enabled: Boolean(selectedId),
    refetchInterval: 4_000,
  });

  const selected = conversationsQuery.data?.results.find((item) => item.id === selectedId);
  const conversations = useMemo(() => {
    const term = search.trim().toLowerCase();
    const all = conversationsQuery.data?.results ?? [];
    return term
      ? all.filter((item) => `${item.title} ${item.student_name ?? ""} ${item.last_message ?? ""}`.toLowerCase().includes(term))
      : all;
  }, [conversationsQuery.data, search]);

  const chooseConversation = (id: string) => {
    const next = new URLSearchParams(params);
    next.set("conversation", id);
    setParams(next);
  };
  const closeConversation = () => {
    const next = new URLSearchParams(params);
    next.delete("conversation");
    setParams(next);
  };

  const createMutation = useMutation({
    mutationFn: (recipient: ChatRecipient) => createChatConversation(recipient.id, studentId),
    onSuccess: async (result) => {
      setPickerOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["chat", "conversations"] });
      chooseConversation(result.id);
    },
  });
  const sendMutation = useMutation({
    mutationFn: () => sendChatMessage(selectedId, {
      body: draft,
      file: attachment,
      clientId: typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
            const random = Math.floor(Math.random() * 16);
            return (character === "x" ? random : (random & 3) | 8).toString(16);
          }),
    }),
    onSuccess: async () => {
      setDraft("");
      setAttachment(undefined);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["chat", "messages", selectedId] }),
        queryClient.invalidateQueries({ queryKey: ["chat", "conversations"] }),
        queryClient.invalidateQueries({ queryKey: ["notifications"] }),
      ]);
    },
  });
  const deleteMutation = useMutation({
    mutationFn: (messageId: string) => deleteChatMessage(selectedId, messageId),
    onSuccess: () => Promise.all([
      queryClient.invalidateQueries({ queryKey: ["chat", "messages", selectedId] }),
      queryClient.invalidateQueries({ queryKey: ["chat", "conversations"] }),
    ]),
  });

  const messages = messagesQuery.data?.results ?? [];
  const newestMessage = messages.at(-1)?.id ?? "";
  useEffect(() => {
    if (!selectedId || !newestMessage || readRef.current === `${selectedId}:${newestMessage}`) return;
    readRef.current = `${selectedId}:${newestMessage}`;
    void markChatRead(selectedId).then(() => {
      void queryClient.invalidateQueries({ queryKey: ["chat", "conversations"] });
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
    });
  }, [newestMessage, queryClient, selectedId]);
  useEffect(() => {
    if (newestMessage) endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [newestMessage]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if ((!draft.trim() && !attachment) || !selectedId || sendMutation.isPending) return;
    sendMutation.mutate();
  };

  return (
    <>
      <section className={selectedId ? "chat-layout has-selection" : "chat-layout"} aria-label="School messages">
        <aside className="chat-conversations">
          <header>
            <span><strong>Messages</strong><small>Private school communication</small></span>
            <button type="button" onClick={() => setPickerOpen(true)} aria-label="Start a new message"><UserRoundPlus size={19} /></button>
          </header>
          <label className="chat-search">
            <Search size={16} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search conversations" />
          </label>
          <div className="chat-conversation-list">
            {conversationsQuery.isPending ? (
              <div className="chat-state"><LoaderCircle className="chat-spin" size={20} /><span>Loading conversations…</span></div>
            ) : conversationsQuery.isError ? (
              <div className="chat-state is-error"><span>Messages could not be loaded.</span><button type="button" onClick={() => void conversationsQuery.refetch()}>Try again</button></div>
            ) : conversations.length ? conversations.map((conversation) => (
              <button
                type="button"
                key={conversation.id}
                className={conversation.id === selectedId ? "is-active" : ""}
                onClick={() => chooseConversation(conversation.id)}
              >
                <span className="chat-avatar">{conversation.avatar_url ? <img src={conversation.avatar_url} alt="" /> : initials(conversation.title)}</span>
                <span className="chat-conversation-copy">
                  <span><strong>{conversation.title}</strong><time>{relativeTime(conversation.last_message_at)}</time></span>
                  {conversation.student_name ? <small className="chat-student-context">About {conversation.student_name}</small> : null}
                  <small>{conversation.last_message ?? "Start the conversation"}</small>
                </span>
                {conversation.unread_count > 0 ? <b className="chat-unread">{conversation.unread_count > 99 ? "99+" : conversation.unread_count}</b> : null}
              </button>
            )) : (
              <div className="chat-state chat-state--empty">
                <MessageCircle size={24} />
                <strong>No conversations yet</strong>
                <span>Start a secure message with an approved school contact.</span>
                <button type="button" onClick={() => setPickerOpen(true)}>New message</button>
              </div>
            )}
          </div>
        </aside>

        <section className="chat-thread">
          {!selectedId ? (
            <div className="chat-thread-empty">
              <span><MessageCircle size={30} /></span>
              <h2>Your school conversations</h2>
              <p>Select a conversation or start a new message. Personal contact details stay private.</p>
              <button type="button" onClick={() => setPickerOpen(true)}><UserRoundPlus size={17} /> New message</button>
            </div>
          ) : (
            <>
              <header className="chat-thread__header">
                <button className="chat-back" type="button" onClick={closeConversation} aria-label="Back to conversations"><ArrowLeft size={19} /></button>
                <span className="chat-avatar">{initials(selected?.title ?? "Chat")}</span>
                <span><strong>{selected?.title ?? "Conversation"}</strong><small>{selected?.student_name ? `About ${selected.student_name}` : "School communication"}</small></span>
                <i title="Secure school conversation">Secure</i>
              </header>
              <div className="chat-messages" aria-live="polite">
                {messagesQuery.isPending ? (
                  <div className="chat-state"><LoaderCircle className="chat-spin" size={20} /><span>Loading messages…</span></div>
                ) : messagesQuery.isError ? (
                  <div className="chat-state is-error"><span>Conversation could not be loaded.</span><button type="button" onClick={() => void messagesQuery.refetch()}>Try again</button></div>
                ) : messages.length ? messages.map((message) => (
                  <Bubble
                    key={message.id}
                    message={message}
                    onDelete={() => {
                      if (window.confirm("Delete this message?")) deleteMutation.mutate(message.id);
                    }}
                    onReport={() => {
                      const reason = window.prompt("Why are you reporting this message?");
                      if (reason?.trim()) void reportChatMessage(selectedId, message.id, reason.trim());
                    }}
                  />
                )) : (
                  <div className="chat-state chat-state--empty"><MessageCircle size={24} /><strong>Start the conversation</strong><span>Messages are visible only to approved participants.</span></div>
                )}
                <div ref={endRef} />
              </div>
              <form className="chat-composer" onSubmit={submit}>
                {attachment ? (
                  <div className="chat-composer__file"><FileText size={15} /><span>{attachment.name}</span><button type="button" onClick={() => setAttachment(undefined)} aria-label="Remove attachment"><X size={15} /></button></div>
                ) : null}
                <div>
                  <label className="chat-attach-button" aria-label="Attach a file">
                    <Paperclip size={19} />
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,application/pdf,.doc,.docx"
                      onChange={(event) => setAttachment(event.target.files?.[0])}
                    />
                  </label>
                  <textarea
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    placeholder="Write a message…"
                    rows={1}
                    maxLength={4000}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        event.currentTarget.form?.requestSubmit();
                      }
                    }}
                  />
                  <button className="chat-send-button" type="submit" disabled={sendMutation.isPending || (!draft.trim() && !attachment)} aria-label="Send message">
                    {sendMutation.isPending ? <LoaderCircle className="chat-spin" size={18} /> : <Send size={18} />}
                  </button>
                </div>
                {sendMutation.isError ? <p>{sendMutation.error.message}</p> : null}
              </form>
            </>
          )}
        </section>
      </section>
      {pickerOpen ? (
        <RecipientPicker
          recipients={recipientsQuery.data?.results ?? []}
          pending={recipientsQuery.isPending || createMutation.isPending}
          onClose={() => setPickerOpen(false)}
          onChoose={(recipient) => createMutation.mutate(recipient)}
        />
      ) : null}
      <span className="sr-only" aria-live="polite">{auth?.user ? `Signed in as ${auth.user.display_name}` : ""}</span>
    </>
  );
}

function ChatRoute({ portal }: { portal: Portal }) {
  const [params, setParams] = useSearchParams();
  const studentId = params.get("student_id") ?? undefined;
  const students = useQuery({
    queryKey: ["school", "accessible-students"],
    queryFn: getAccessibleStudents,
    enabled: portal === "parent",
    staleTime: 60_000,
  });
  const selectedStudent = students.data?.results.find((student) => student.id === studentId)
    ?? students.data?.results[0];
  const parentChild = selectedStudent ? {
    id: selectedStudent.id,
    name: selectedStudent.user.display_name,
    grade: `Grade ${selectedStudent.current_enrollment.grade}`,
    section: selectedStudent.current_enrollment.section,
    board: selectedStudent.current_enrollment.board,
    rollNumber: String(selectedStudent.current_enrollment.roll_number),
    avatarUrl: selectedStudent.avatar_url,
  } : undefined;
  const selectChild = (nextStudentId: string) => {
    const next = new URLSearchParams(params);
    next.set("student_id", nextStudentId);
    next.delete("conversation");
    setParams(next);
  };

  if (portal === "parent") {
    return <ParentShell active="chat" pageLabel="Messages" child={parentChild} selectedChildId={selectedStudent?.id} onSelectChild={selectChild}><ChatExperience portal={portal} /></ParentShell>;
  }
  if (portal === "student") {
    return <StudentShell activeNav="chat"><ChatExperience portal={portal} /></StudentShell>;
  }
  if (portal === "teacher") {
    return <OperationsShell portal="teacher" active="chat" title="Messages" subtitle="Secure school communication"><ChatExperience portal={portal} /></OperationsShell>;
  }
  return <OperationsShell portal="principal" active="chat" title="Messages" subtitle="Secure school communication"><ChatExperience portal={portal} /></OperationsShell>;
}

export function ParentChatRoute() { return <ChatRoute portal="parent" />; }
export function StudentChatRoute() { return <ChatRoute portal="student" />; }
export function TeacherChatRoute() { return <ChatRoute portal="teacher" />; }
export function PrincipalChatRoute() { return <ChatRoute portal="principal" />; }
