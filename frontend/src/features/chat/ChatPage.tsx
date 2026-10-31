import { applicationNow } from "../simulation/applicationTime";
import { ThatCampusLoadingIcon as LoaderCircle } from "../../components/ThatCampusLoader";
import { ProductIcon } from "../../components/ProductIcon";
// @ts-nocheck
import { type InfiniteData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCheck,
  ArrowLeft,
  FileText,
  Flag,
  MessageCircle,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Search,
  ShieldCheck,
  UsersRound,
  Send,
  UserRoundPlus,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { useOptionalAuth } from "../auth/AuthContext";
import { useOptionalExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { ApiError } from "../../lib/api";
import { ChatHistoryRefreshLimitError, createChatHistoryReader } from "./chat-history";
import { getAccessibleStudents } from "../school/api";
import { ParentShell } from "../../pages/parent/ParentShell";
import { StudentShell } from "../../pages/student/StudentShell";
import { OperationsShell } from "../../pages/operations/OperationsShell";
import { searchForStudentContext } from "../navigation/studentContextSearch";
import {
  createChatConversation,
  createChatGroup,
  editChatMessage,
  getChatConversation,
  getChatConversationDirectory,
  getChatPolicy,
  getChatRecipients,
  markChatRead,
  reportChatMessage,
  sendChatMessage,
  type ChatConversation,
  type ChatGroupType,
  type ChatMessage,
  type ChatMessagePage,
  type ChatPolicy,
  type ChatRecipient,
} from "./api";
import "./chat.css";

type ChatPresentation = "parent" | "student" | "staff";

/**
 * The canonical Messages area is composed from an explicit workspace surface,
 * not from a Teacher/Parent/Student portal. Domain APIs remain the authority
 * for conversation membership and every read/write action.
 */
export interface ChatWorkspaceContext {
  readonly kind: "responsibility" | "self" | "dependent";
  readonly label: string;
  readonly studentId?: string;
  readonly canCreateGroups: boolean;
}

function initials(name: string) {
  return name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

function relativeTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const minutes = Math.max(0, Math.floor((applicationNow().getTime() - date.getTime()) / 60_000));
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
  error,
  onRetry,
}: {
  recipients: ChatRecipient[];
  pending: boolean;
  onClose: () => void;
  onChoose: (recipient: ChatRecipient) => void;
  error?: string;
  onRetry?: () => void;
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
          {error ? <div className="chat-state is-error" role="alert"><span>{error}</span>{onRetry ? <button type="button" onClick={onRetry}>Try again</button> : null}</div> : null}
          {pending ? (
            <div className="chat-state"><LoaderCircle className="chat-spin" size={20} /><span>Finding your school contacts…</span></div>
          ) : visible.length ? visible.map((recipient) => (
            <button type="button" key={`${recipient.school_id}-${recipient.id}`} onClick={() => onChoose(recipient)}>
              <span className="chat-avatar">{recipient.avatar_url ? <img src={recipient.avatar_url} alt="" /> : initials(recipient.name)}</span>
              <span><strong>{recipient.name}</strong><small>{recipient.detail} · {recipient.school_name}</small></span>
              <MessageCircle size={18} />
            </button>
          )) : (
            error ? null : <div className="chat-state"><UserRoundPlus size={21} /><span>No approved contacts match your search.</span></div>
          )}
        </div>
      </section>
    </div>
  );
}

const groupNames: Record<ChatGroupType, string> = {
  student_group: "Student group", parent_group: "Parent group", activity: "Activity/trip",
  staff: "Staff group", child_support: "Child support", announcement: "Announcement",
};
function GovernanceDialog({ recipients, canManage, onClose, onCreate, pending, error, onRetry }: {
  recipients: ChatRecipient[]; canManage: boolean; onClose: () => void;
  onCreate: (input: { title: string; group_type: ChatGroupType; member_ids: string[]; school_id: string }) => void; pending: boolean;
  error?: string; onRetry?: () => void;
}) {
  const [title,setTitle]=useState(""); const [kind,setKind]=useState<ChatGroupType>("student_group"); const [ids,setIds]=useState<string[]>([]);
  const kinds: ChatGroupType[] = canManage ? ["student_group","parent_group","activity","staff","announcement"] : ["student_group","parent_group","activity"];
  const roles: Record<string,string[]> = {student_group:["student","staff","admin"],parent_group:["guardian","staff","admin"],activity:["student","guardian","staff","admin"],staff:["staff","admin"],announcement:["student","guardian","staff","admin"]};
  const eligible=recipients.filter((r)=>roles[kind]?.includes(r.membership_role));
  const selectedSchoolId = eligible.find((recipient) => ids.includes(recipient.id))?.school_id;
  const visibleEligible = selectedSchoolId
    ? eligible.filter((recipient) => recipient.school_id === selectedSchoolId)
    : eligible;
  return <div className="chat-picker-backdrop" role="presentation" onMouseDown={(e)=>{if(e.target===e.currentTarget)onClose();}}>
    <form className="chat-picker chat-group-form" role="dialog" aria-modal="true" aria-labelledby="chat-group-title" onSubmit={(e)=>{e.preventDefault();if(title.trim().length>=3&&ids.length&&selectedSchoolId)onCreate({title:title.trim(),group_type:kind,member_ids:ids,school_id:selectedSchoolId});}}>
      <header><span><strong id="chat-group-title">Create group</strong><small>Only eligible school members can be selected</small></span><button type="button" onClick={onClose} aria-label="Close"><X size={19}/></button></header>
      <label className="chat-form-field"><span>Group name</span><input value={title} onChange={(e)=>setTitle(e.target.value)} minLength={3} maxLength={180} autoFocus /></label>
      <label className="chat-form-field"><span>Group type</span><select value={kind} onChange={(e)=>{setKind(e.target.value as ChatGroupType);setIds([]);}}>{kinds.map((k)=><option key={k} value={k}>{groupNames[k]}</option>)}</select></label>
      <div className="chat-member-list">{visibleEligible.map((r)=><label className="chat-member-option" key={`${r.school_id}-${r.id}`}><input type="checkbox" checked={ids.includes(r.id)} onChange={()=>setIds(ids.includes(r.id)?ids.filter(x=>x!==r.id):[...ids,r.id])}/><span>{r.name}</span><small>{r.detail}</small></label>)}</div>
      {error ? <div className="chat-state is-error" role="alert"><span>{error}</span>{onRetry ? <button type="button" onClick={onRetry}>Try again</button> : null}</div> : null}
      <footer className="chat-dialog-actions"><button type="button" onClick={onClose}>Cancel</button><button type="submit" disabled={pending||title.trim().length<3||!ids.length||!selectedSchoolId}>{pending?"Creating…":"Create group"}</button></footer>
    </form>
  </div>;
}
function PrivacyDialog({ policy, onClose }: { policy?: ChatPolicy; onClose:()=>void }) {
  return <div className="chat-picker-backdrop" role="presentation" onMouseDown={(e)=>{if(e.target===e.currentTarget)onClose();}}>
    <section className="chat-picker chat-privacy-panel"><header><span><strong>Messaging privacy & safeguards</strong><small>Campus relationships and reporting</small></span><button type="button" onClick={onClose} aria-label="Close"><X size={19}/></button></header>
      <div className="chat-privacy-copy"><p><ShieldCheck size={18}/> Contacts follow current campus relationships; phone numbers and email addresses stay private.</p><p><ShieldCheck size={18}/> Reports are reviewable only by authorised staff and audit logged.</p><p><ShieldCheck size={18}/> Automatic message deletion is not enabled.</p></div>
      {policy?.can_manage ? <Link className="chat-policy-hint" to={`/more/setup/institution/operating-rules?school=${policy.school_id}&rule=messages`}>Messaging operating rules</Link> : null}
    </section>
  </div>;
}

function MessageActionsDialog({ message, position, onClose, onEdit, onReport }: {
  message: ChatMessage;
  position: { left: number; top: number };
  onClose: () => void;
  onEdit: () => void;
  onReport: () => void;
}) {
  const canEdit = message.is_mine
    && !message.is_deleted
    && Boolean(message.body.trim())
    && Boolean(message.editable_until) && applicationNow().getTime() < Date.parse(message.editable_until!);
  const canReport = !message.is_mine && !message.is_deleted && !message.is_reported_by_me;

  return (
    <div className="chat-picker-backdrop chat-actions-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section
        className="chat-actions-menu"
        role="menu"
        aria-label="Message actions"
        style={{ left: position.left, top: position.top }}
      >
        {canEdit ? (
          <button type="button" role="menuitem" onClick={onEdit}>
            <Pencil size={18} />
            <span>Edit</span>
          </button>
        ) : null}
        {canReport ? (
          <button type="button" role="menuitem" className="is-flag" onClick={onReport}>
            <Flag size={18} />
            <span>Flag message</span>
          </button>
        ) : null}
      </section>
    </div>
  );
}

function ReportDialog({ message, pending, error, onClose, onSubmit }: {
  message: ChatMessage;
  pending: boolean;
  error?: string;
  onClose: () => void;
  onSubmit: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const suggestions = ["Inappropriate language", "Bullying or harassment", "Safety concern", "Spam or unrelated"];
  return (
    <div className="chat-picker-backdrop chat-report-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <form className="chat-report-sheet" role="dialog" aria-modal="true" aria-labelledby="report-message-title" onSubmit={(event) => {
        event.preventDefault();
        if (reason.trim().length >= 3) onSubmit(reason.trim());
      }}>
        <span className="chat-report-sheet__handle" />
        <header>
          <span className="chat-report-icon"><Flag size={20} /></span>
          <span><strong id="report-message-title">Report this message?</strong><small>Your report goes privately to authorised school staff.</small></span>
          <button type="button" onClick={onClose} aria-label="Close"><X size={19} /></button>
        </header>
        <blockquote><strong>{message.sender_name}</strong><p>{message.body || "Attachment"}</p></blockquote>
        <div className="chat-report-reasons">
          {suggestions.map((item) => <button type="button" key={item} className={reason === item ? "is-selected" : ""} onClick={() => setReason(item)}>{item}</button>)}
        </div>
        <label>
          <span>Tell us what happened</span>
          <textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={2} maxLength={500} placeholder="Add a short reason…" />
        </label>
        {error ? <p className="chat-report-error">{error}</p> : null}
        <footer>
          <button type="button" className="chat-report-cancel" onClick={onClose}>Cancel</button>
          <button type="submit" className="chat-report-submit" disabled={pending || reason.trim().length < 3}>{pending ? <LoaderCircle className="chat-spin" size={17} /> : <Flag size={16} />} Submit report</button>
        </footer>
      </form>
    </div>
  );
}

function Bubble({
  message,
  onActions,
}: {
  message: ChatMessage;
  onActions: (position: { left: number; top: number }) => void;
}) {
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const bubbleRef = useRef<HTMLElement>(null);
  const canEdit = message.is_mine
    && !message.is_deleted
    && Boolean(message.body.trim())
    && Boolean(message.editable_until) && applicationNow().getTime() < Date.parse(message.editable_until!);
  const canReport = !message.is_mine && !message.is_deleted && !message.is_reported_by_me;
  const hasActions = canEdit || canReport;
  const cancelLongPress = () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    longPressTimer.current = undefined;
  };
  const openActions = () => {
    const rect = bubbleRef.current?.getBoundingClientRect();
    if (!rect) return;
    const menuWidth = 154;
    const menuHeight = 56;
    const horizontal = message.is_mine ? rect.right - menuWidth : rect.left;
    const left = Math.max(8, Math.min(horizontal, window.innerWidth - menuWidth - 8));
    const below = rect.bottom + 6;
    const top = below + menuHeight <= window.innerHeight - 8
      ? below
      : Math.max(8, rect.top - menuHeight - 6);
    onActions({ left, top });
  };
  const startLongPress = () => {
    if (!hasActions) return;
    cancelLongPress();
    longPressTimer.current = setTimeout(() => {
      longPressTimer.current = undefined;
      openActions();
      if ("vibrate" in navigator) navigator.vibrate(35);
    }, 550);
  };
  useEffect(() => cancelLongPress, []);

  return (
    <article
      ref={bubbleRef}
      className={[message.is_mine ? "chat-bubble is-mine" : "chat-bubble", hasActions ? "is-reportable" : ""].filter(Boolean).join(" ")}
      onPointerDown={startLongPress}
      onPointerUp={cancelLongPress}
      onPointerCancel={cancelLongPress}
      onPointerLeave={cancelLongPress}
      onContextMenu={(event) => {
        if (hasActions) {
          event.preventDefault();
          cancelLongPress();
          openActions();
        }
      }}
    >
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
        {message.is_mine && new Date(message.updated_at).getTime() > new Date(message.created_at).getTime() ? <small>Edited</small> : null}
        {!message.is_deleted && !message.is_mine && message.is_reported_by_me ? (
          <span className="chat-message-flagged" role="img" aria-label="Reported" title={"Report " + (message.report_status ?? "submitted").replaceAll("_", " ")}>
            <Flag size={13} fill="currentColor" />
          </span>
        ) : null}
        {hasActions ? (
          <button
            type="button"
            className="chat-message-options"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => { event.stopPropagation(); cancelLongPress(); openActions(); }}
            aria-label="Message options"
            title="Message options"
          ><MoreHorizontal size={15} /></button>
        ) : null}
      </footer>
    </article>
  );
}
export function mergeSelectedConversation(
  conversations: readonly ChatConversation[],
  selected?: ChatConversation,
): ChatConversation[] {
  if (!selected) return [...conversations];
  const existingIndex = conversations.findIndex((conversation) => conversation.id === selected.id);
  if (existingIndex === -1) return [selected, ...conversations];
  return conversations.map((conversation, index) => index === existingIndex ? selected : conversation);
}

export function ChatExperience({ context }: { context: ChatWorkspaceContext }) {
  const auth = useOptionalAuth();
  const environment = useOptionalExecutionEnvironment();
  const scope = JSON.stringify([auth?.user?.id ?? "anonymous", environment?.mode ?? "live", environment?.namespaceId ?? "", environment?.institutionId ?? auth?.user?.active_school_id ?? "", context.kind, context.studentId ?? "all"]);
  return <ChatScope key={scope} context={context} scope={scope} />;
}

function ChatScope({ context, scope }: { context: ChatWorkspaceContext; scope: string }) {
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  // Retain a short-lived in-memory return position, never private cursors in a
  // shareable URL or localStorage. The complete account/world/child scope is
  // part of the key; reload/session expiry safely starts at the first page.
  const navigationKey = useMemo(() => ["chat", "directory-navigation", scope], [scope]);
  const [saved] = useState(() => queryClient.getQueryData<{search:string;directorySearch:string;cursors:string[]}>(navigationKey));
  const [search, setSearch] = useState(saved?.search ?? "");
  const [directorySearch, setDirectorySearch] = useState(saved?.directorySearch ?? "");
  const [cursors, setCursors] = useState<string[]>(saved?.cursors ?? []);
  useEffect(() => { queryClient.setQueryData(navigationKey, { search, directorySearch, cursors }); }, [queryClient, navigationKey, search, directorySearch, cursors]);
  useEffect(() => {
    if (search.trim() === directorySearch) return;
    const timer = setTimeout(() => { setDirectorySearch(search.trim()); setCursors([]); }, 300);
    return () => clearTimeout(timer);
  }, [search, directorySearch]);
  return <ScopedChatExperience key={params.get("conversation") ?? "directory"} context={context} scope={scope} search={search} setSearch={setSearch} directorySearch={directorySearch} cursors={cursors} setCursors={setCursors} />;
}

function ScopedChatExperience({ context, scope, search, setSearch, directorySearch, cursors, setCursors }: { context: ChatWorkspaceContext; scope: string; search: string; setSearch: (value: string) => void; directorySearch: string; cursors: string[]; setCursors: (value: string[]) => void }) {
  const auth = useOptionalAuth();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const selectedId = params.get("conversation") ?? "";
  const studentId = context.studentId;
  const [pickerOpen, setPickerOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState("");
  const [reportTarget, setReportTarget] = useState<ChatMessage>();
  const [actionTarget, setActionTarget] = useState<{ message: ChatMessage; position: { left: number; top: number } }>();
  const [reportNotice, setReportNotice] = useState("");
  const [draft, setDraft] = useState("");
  const [attachment, setAttachment] = useState<File>();
  const [readError, setReadError] = useState<{ conversationId: string; token: string } | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const readRef = useRef("");

  const conversationsQuery = useQuery({
    queryKey: ["chat", "conversations", scope, "directory", directorySearch, cursors.at(-1) ?? "first"],
    queryFn: () => getChatConversationDirectory({ search: directorySearch, cursor: cursors.at(-1), studentId }),
    refetchInterval: 10_000,
    staleTime: 5_000,
  });
  const selectedConversationQuery = useQuery({
    queryKey: ["chat", "conversation", selectedId, scope],
    queryFn: () => getChatConversation(selectedId, studentId),
    enabled: Boolean(selectedId),
    refetchInterval: 10_000,
    staleTime: 5_000,
    retry: false,
  });
  const selected = selectedConversationQuery.isError ? undefined : selectedConversationQuery.data;
  const recipientsPurpose = groupOpen ? "group" : "direct";
  const recipientsQuery = useQuery({
    queryKey: ["chat", "recipients", scope, recipientsPurpose],
    queryFn: () => getChatRecipients(studentId, recipientsPurpose),
    enabled: pickerOpen || groupOpen,
    staleTime: 60_000,
  });
  const policyQuery = useQuery({ queryKey: ["chat","policy",scope], queryFn: getChatPolicy, staleTime: 60_000 });
  const historyKey = useMemo(() => ["chat", "messages", selectedId, "history", scope], [selectedId, scope]);
  const readHistory = useMemo(() => createChatHistoryReader(queryClient, historyKey, selectedId), [queryClient, historyKey, selectedId]);
  const messagesQuery = useInfiniteQuery({
    queryKey: historyKey,
    queryFn: readHistory,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.has_more ? page.next_cursor ?? undefined : undefined,
    enabled: Boolean(selectedId && selected),
    refetchInterval: 4_000,
    retry: false,
  });
  const messagesDenied = messagesQuery.error instanceof ApiError && [401, 403, 404].includes(messagesQuery.error.status);

  const conversations = useMemo(() => {
    if (conversationsQuery.error instanceof ApiError && [401,403,404].includes(conversationsQuery.error.status)) return [];
    const term = directorySearch.toLowerCase();
    // The server searches the complete authorized directory BEFORE slicing.
    // Only the independent exact selected projection needs this local check.
    const selectedMatches = selected && (!term || `${selected.title} ${selected.student_name ?? ""} ${selected.last_message ?? ""}`.toLowerCase().includes(term));
    const all = mergeSelectedConversation(conversationsQuery.data?.results ?? [], selectedMatches ? selected : undefined);
    const scoped = studentId
      ? all.filter((item) => item.context_student_id === null || item.context_student_id === studentId)
      : all;
    return scoped;
  }, [conversationsQuery.data, conversationsQuery.error, directorySearch, selected, studentId]);

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
    mutationFn: (recipient: ChatRecipient) => createChatConversation(
      recipient.id,
      recipient.school_id,
      studentId ?? recipient.student_id ?? undefined,
    ),
    onSuccess: async (result) => {
      setPickerOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["chat", "conversations"] });
      chooseConversation(result.id);
    },
  });
  const groupMutation = useMutation({ mutationFn: (input: { title:string; group_type:ChatGroupType; member_ids:string[]; school_id:string }) => createChatGroup(input), onSuccess: async (r) => { setGroupOpen(false); await queryClient.invalidateQueries({queryKey:["chat","conversations"]}); chooseConversation(r.id); } });
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
        queryClient.invalidateQueries({ queryKey: ["chat", "conversation", selectedId] }),
        queryClient.invalidateQueries({ queryKey: ["chat", "conversations"] }),
        queryClient.invalidateQueries({ queryKey: ["notifications"] }),
      ]);
    },
  });
  const reportMutation = useMutation({
    mutationFn: (reason: string) => reportChatMessage(selectedId, reportTarget?.id ?? "", reason),
    onSuccess: async () => {
      const reportedMessageId = reportTarget?.id;
      if (reportedMessageId) {
        queryClient.setQueryData<InfiniteData<ChatMessagePage>>(historyKey, (current) => current ? ({
          ...current,
          pages: current.pages.map((page) => ({ ...page, results: page.results.map((message) => message.id === reportedMessageId
            ? { ...message, is_reported_by_me: true, report_status: "open" as const }
            : message) })),
        }) : current);
      }
      setReportTarget(undefined);
      setReportNotice("Report sent privately to the school.");
      await queryClient.invalidateQueries({ queryKey: ["chat", "messages", selectedId] });
    },
  });
  const editMutation = useMutation({
    mutationFn: () => editChatMessage(selectedId, editingMessageId, draft),
    onSuccess: async () => {
      setEditingMessageId(""); setDraft("");
      await Promise.all([queryClient.invalidateQueries({ queryKey: ["chat", "messages", selectedId] }), queryClient.invalidateQueries({ queryKey: ["chat", "conversation", selectedId] }), queryClient.invalidateQueries({ queryKey: ["chat", "conversations"] })]);
    },
  });
  const messages = useMemo(() => {
    if (messagesDenied) return [];
    const unique = new Map<string, ChatMessage>();
    for (const page of [...(messagesQuery.data?.pages ?? [])].reverse()) {
      for (const message of page.results) unique.set(message.id, message);
    }
    // Preserve the server's tuple order. JSON Date strings can round distinct
    // PostgreSQL microseconds to the same millisecond; client sorting loses it.
    return [...unique.values()];
  }, [messagesQuery.data, messagesDenied]);
  const newestMessage = messages.at(-1)?.id ?? "";
  const updateReadStatus = useCallback(async (conversationId: string, token: string) => {
    readRef.current = token;
    try {
      await markChatRead(conversationId);
      setReadError(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["chat", "conversation", conversationId] }),
        queryClient.invalidateQueries({ queryKey: ["chat", "conversations"] }),
        queryClient.invalidateQueries({ queryKey: ["notifications"] }),
      ]);
    } catch {
      setReadError({ conversationId, token });
    }
  }, [queryClient]);
  useEffect(() => {
    if (!selectedId || !newestMessage || readRef.current === `${selectedId}:${newestMessage}`) return;
    void updateReadStatus(selectedId, `${selectedId}:${newestMessage}`);
  }, [newestMessage, selectedId, updateReadStatus]);
  useEffect(() => {
    const scroller = endRef.current?.parentElement;
    if (newestMessage && scroller) scroller.scrollTop = scroller.scrollHeight;
  }, [newestMessage]);
  useEffect(() => {
    if (!reportNotice) return;
    const timer = setTimeout(() => setReportNotice(""), 3500);
    return () => clearTimeout(timer);
  }, [reportNotice]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if ((!draft.trim() && !attachment) || !selectedId || messagesDenied) return;
    if (editingMessageId) { if (!editMutation.isPending) editMutation.mutate(); return; }
    if (sendMutation.isPending) return;
    sendMutation.mutate();
  };

  return (
    <>
      <section className={selectedId ? "chat-layout has-selection" : "chat-layout"} aria-label="School messages">
        <aside className="chat-conversations">
          <header>
            <span className="sr-only">Conversation actions</span>
            <div className="chat-directory-actions">
              <button type="button" onClick={()=>{createMutation.reset();setPickerOpen(true);}} aria-label="Start a new message"><Pencil size={18}/><span>New message</span></button>
              <details className="workspace-add-menu"><summary aria-label="Conversation options"><MoreHorizontal size={20}/></summary><div>
                {context.canCreateGroups ? <button type="button" onClick={event=>{event.currentTarget.closest('details')?.removeAttribute('open');groupMutation.reset();setGroupOpen(true);}}><UsersRound size={18}/>Create group</button> : null}
                <button type="button" onClick={event=>{event.currentTarget.closest('details')?.removeAttribute('open');setPrivacyOpen(true);}}><ShieldCheck size={18}/>Messaging privacy</button>
              </div></details>
            </div>
          </header>
          <label className="chat-search">
            <Search size={16} />
            <input aria-label="Search conversations" maxLength={120} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search conversations" />
          </label>
          <div className="chat-conversation-list">
            {conversationsQuery.isPending && !conversations.length ? (
              <div className="chat-state"><LoaderCircle className="chat-spin" size={20} /><span>Loading conversations…</span></div>
            ) : conversationsQuery.isError && !conversations.length ? (
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
                <ProductIcon name="messages" size={40} />
                <strong>{cursors.length ? "No conversations on this page" : directorySearch ? "No conversations match" : "No conversations yet"}</strong>
                <span>{cursors.length ? "Conversations may have moved or your access changed. Return to the first page to check recent activity." : directorySearch ? "Try a different name or message. Search covers all your authorized conversations." : "Start a secure message with an approved school contact."}</span>
                {cursors.length ? <button type="button" onClick={() => setCursors([])}>First page</button> : directorySearch ? <button type="button" onClick={() => setSearch("")}>Clear search</button> : <button type="button" onClick={() => setPickerOpen(true)}>New message</button>}
              </div>
            )}
          </div>
          {conversationsQuery.isError && conversations.length ? <div className="chat-read-error" role="status"><span>Conversations could not be refreshed. The last verified page is still shown.</span><button type="button" onClick={() => void conversationsQuery.refetch()}>Try again</button></div> : null}
          <nav className="chat-directory-pagination" aria-label="Conversation pages">
            <button type="button" disabled={!cursors.length || conversationsQuery.isFetching} onClick={() => setCursors(cursors.slice(0,-1))}>Previous</button>
            <span>Page {cursors.length + 1}</span>
            <button type="button" disabled={!conversationsQuery.data?.has_more || !conversationsQuery.data.next_cursor || conversationsQuery.isFetching || conversationsQuery.isError} onClick={() => setCursors([...cursors, conversationsQuery.data!.next_cursor!])}>Next</button>
          </nav>
          {conversationsQuery.isError && cursors.length ? <button type="button" className="chat-history-button" onClick={() => setCursors([])}>First page</button> : null}
        </aside>

        <section className="chat-thread">
          {!selectedId ? (
            <div className="chat-thread-empty">
              <span><ProductIcon name="messages" size={40} /></span>
              <h2>{context.label}</h2>
              <p>Select a conversation or start a new message. Personal contact details stay private.</p>
              <button type="button" onClick={() => setPickerOpen(true)}><UserRoundPlus size={17} /> New message</button>
            </div>
          ) : selectedConversationQuery.isPending ? (
            <>
              <header className="chat-thread__header">
                <button type="button" className="chat-back" onClick={closeConversation} aria-label="Back to conversations"><ArrowLeft size={20} /></button>
                <span className="chat-avatar"><LoaderCircle className="chat-spin" size={18} /></span>
                <span><strong>Loading conversation…</strong><small>Checking access and messaging settings</small></span>
              </header>
              <div className="chat-thread-empty" role="status"><LoaderCircle className="chat-spin" size={24} /><p>Loading the selected conversation…</p></div>
            </>
          ) : selectedConversationQuery.isError || !selected ? (
            <>
              <header className="chat-thread__header">
                <button type="button" className="chat-back" onClick={closeConversation} aria-label="Back to conversations"><ArrowLeft size={20} /></button>
                <span className="chat-avatar"><MessageCircle size={18} /></span>
                <span><strong>Conversation unavailable</strong><small>Access or child context could not be verified</small></span>
              </header>
              <div className="chat-thread-empty" role="alert">
                <span><MessageCircle size={30} /></span>
                <h2>Conversation could not be opened</h2>
                <p>It may no longer be available for the selected school or child.</p>
                <button type="button" onClick={() => void selectedConversationQuery.refetch()}>Try again</button>
              </div>
            </>
          ) : (
            <>
              <header className="chat-thread__header">
                <button type="button" className="chat-back" onClick={closeConversation} aria-label="Back to conversations"><ArrowLeft size={20} /></button>
                <span className="chat-avatar">{initials(selected?.title ?? "Chat")}</span>
                <span><strong>{selected?.title ?? "Conversation"}</strong><small>{selected?.student_name ? `About ${selected.student_name}` : "School communication"}</small></span>
                <span className="chat-thread__meta">{selected?.group_type ? <b>{groupNames[selected.group_type]}</b> : null}<i title="Secure school conversation"><ShieldCheck size={13}/> Secure</i></span>
              </header>
              <div className="chat-messages" aria-live="polite">
                {messagesQuery.hasNextPage && !messagesDenied ? <button type="button" className="chat-history-button" disabled={messagesQuery.isFetchingNextPage || messagesQuery.isRefetching} onClick={() => void messagesQuery.fetchNextPage()}>{messagesQuery.isFetchingNextPage ? "Loading earlier messages…" : messagesQuery.isFetchNextPageError ? "Try loading earlier messages again" : "Earlier messages"}</button> : null}
                {messagesQuery.isError && messages.length > 0 && !messagesQuery.isFetchNextPageError ? <div className="chat-read-error" role="status"><span>{messagesQuery.error instanceof ChatHistoryRefreshLimitError ? messagesQuery.error.message : "Messages could not be refreshed. The last verified messages are still shown."}</span><button type="button" onClick={() => void messagesQuery.refetch()}>Try again</button>{messagesQuery.error instanceof ChatHistoryRefreshLimitError ? <button type="button" onClick={() => void queryClient.resetQueries({ queryKey: historyKey, exact: true })}>Show recent messages</button> : null}</div> : null}
                {messagesQuery.isPending ? (
                  <div className="chat-state"><LoaderCircle className="chat-spin" size={20} /><span>Loading messages…</span></div>
                ) : messagesDenied || (messagesQuery.isError && !messages.length) ? (
                  <div className="chat-state is-error" role="alert"><span>{messagesDenied ? "Conversation access changed. Messages are hidden until access is verified again." : "Conversation could not be loaded."}</span><button type="button" onClick={() => void messagesQuery.refetch()}>Try again</button></div>
                ) : messages.length ? messages.map((message) => (
                  <Bubble
                    key={message.id}
                    message={message}
                    onActions={(position) => setActionTarget({ message, position })}
                  />
                )) : (
                  <div className="chat-state chat-state--empty"><MessageCircle size={24} /><strong>Start the conversation</strong><span>Messages are visible only to approved participants.</span></div>
                )}
                <div ref={endRef} />
              </div>
              {readError?.conversationId === selectedId && !messagesDenied ? <div className="chat-read-error" role="status"><span>Read status could not be updated. Your messages are still available.</span><button type="button" onClick={() => void updateReadStatus(selectedId, readError.token)}>Try again</button></div> : null}
              {editingMessageId && !messagesDenied ? <div className="chat-editing"><span>Editing message</span><button type="button" onClick={() => { setEditingMessageId(""); setDraft(""); }}>Cancel</button></div> : null}
              {messagesDenied ? null : selected?.can_post === false ? <div className="chat-readonly"><ShieldCheck size={18}/><span><strong>Posting is restricted</strong><small>{selected.posting_restriction ?? "Only approved moderators can post."}</small></span></div> : <form className="chat-composer" onSubmit={submit}>
                {attachment ? (
                  <div className="chat-composer__file"><FileText size={15} /><span>{attachment.name}</span><button type="button" onClick={() => setAttachment(undefined)} aria-label="Remove attachment"><X size={15} /></button></div>
                ) : null}
                <div>
                  <label className="chat-attach-button" aria-label="Attach a file">
                    <Paperclip size={19} />
                    <input
                      type="file"
                      aria-label="Attach a file"
                      disabled={sendMutation.isPending || editMutation.isPending || Boolean(editingMessageId)}
                      accept="image/jpeg,image/png,image/webp,application/pdf,.doc,.docx"
                      onChange={(event) => setAttachment(event.target.files?.[0])}
                    />
                  </label>
                  <textarea
                    aria-label="Write a message"
                    disabled={sendMutation.isPending || editMutation.isPending}
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    placeholder="Write a message…"
                    rows={1}
                    maxLength={4000}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                        event.preventDefault();
                        event.currentTarget.form?.requestSubmit();
                      }
                    }}
                  />
                  <button className="chat-send-button" type="submit" disabled={sendMutation.isPending || editMutation.isPending || (!draft.trim() && !attachment)} aria-label="Send message">
                    {sendMutation.isPending || editMutation.isPending ? <LoaderCircle className="chat-spin" size={18} /> : <Send size={18} />}
                  </button>
                </div>
                {(editingMessageId ? editMutation.error : sendMutation.error) ? <p role="alert">{(editingMessageId ? editMutation.error : sendMutation.error)?.message}</p> : null}
              </form>}
            </>
          )}
        </section>
      </section>
      {reportNotice ? <div className="chat-toast" role="status"><ShieldCheck size={17} />{reportNotice}</div> : null}
      {actionTarget && !messagesDenied ? <MessageActionsDialog
        message={actionTarget.message}
        position={actionTarget.position}
        onClose={() => setActionTarget(undefined)}
        onEdit={() => {
          setEditingMessageId(actionTarget.message.id);
          setDraft(actionTarget.message.body);
          setAttachment(undefined);
          setActionTarget(undefined);
        }}
        onReport={() => {
          setReportTarget(actionTarget.message);
          setActionTarget(undefined);
        }}
      /> : null}
      {reportTarget && !messagesDenied ? <ReportDialog message={reportTarget} pending={reportMutation.isPending} error={reportMutation.isError ? reportMutation.error.message : undefined} onClose={() => setReportTarget(undefined)} onSubmit={(reason) => reportMutation.mutate(reason)} /> : null}
      {groupOpen ? <GovernanceDialog recipients={recipientsQuery.data?.results ?? []} canManage={policyQuery.data?.can_manage === true} pending={recipientsQuery.isPending || groupMutation.isPending} error={groupMutation.error?.message ?? recipientsQuery.error?.message} onRetry={recipientsQuery.isError ? () => void recipientsQuery.refetch() : undefined} onClose={()=>setGroupOpen(false)} onCreate={(input)=>groupMutation.mutate(input)} /> : null}
      {privacyOpen ? <PrivacyDialog policy={policyQuery.data} onClose={()=>setPrivacyOpen(false)} /> : null}
      {pickerOpen ? (
        <RecipientPicker
          recipients={recipientsQuery.data?.results ?? []}
          pending={recipientsQuery.isPending || createMutation.isPending}
          error={createMutation.error?.message ?? recipientsQuery.error?.message}
          onRetry={recipientsQuery.isError ? () => void recipientsQuery.refetch() : undefined}
          onClose={() => setPickerOpen(false)}
          onChoose={(recipient) => createMutation.mutate(recipient)}
        />
      ) : null}
      <span className="sr-only" aria-live="polite">{auth?.user ? `Signed in as ${auth.user.display_name}` : ""}</span>
    </>
  );
}

function ChatRoute({ presentation }: { presentation: ChatPresentation }) {
  const [params, setParams] = useSearchParams();
  const studentId = params.get("student_id") ?? undefined;
  const students = useQuery({
    queryKey: ["school", "accessible-students"],
    queryFn: getAccessibleStudents,
    enabled: presentation === "parent",
    staleTime: 60_000,
  });
  if (presentation === "staff" && params.get("moderation") === "reports") {
    return <Navigate to="/areas/safeguarding" replace />;
  }
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
    setParams(searchForStudentContext(params, nextStudentId), { replace: true });
  };

  if (presentation === "parent") {
    return <ParentShell active="chat" pageLabel="Messages" child={parentChild} selectedChildId={selectedStudent?.id} onSelectChild={selectChild}><ChatExperience context={{ kind: "dependent", label: selectedStudent ? `${selectedStudent.user.display_name}'s conversations` : "Family conversations", studentId: selectedStudent?.id, canCreateGroups: false }} /></ParentShell>;
  }
  if (presentation === "student") {
    return <StudentShell activeNav="chat"><ChatExperience context={{ kind: "self", label: "My conversations", canCreateGroups: false }} /></StudentShell>;
  }
  return <OperationsShell active="areas" title="Messages" subtitle="Secure school communication"><ChatExperience context={{ kind: "responsibility", label: "Campus conversations", canCreateGroups: true }} /></OperationsShell>;
}

export function ParentChatRoute() { return <ChatRoute presentation="parent" />; }
export function StudentChatRoute() { return <ChatRoute presentation="student" />; }
export function TeacherChatRoute() { return <ChatRoute presentation="staff" />; }
export function PrincipalChatRoute() { return <ChatRoute presentation="staff" />; }
