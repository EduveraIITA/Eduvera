import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatExperience, mergeSelectedConversation, type ChatWorkspaceContext } from "./ChatPage";
import { ApiError } from "../../lib/api";
import { ChatHistoryRefreshLimitError } from "./chat-history";
import {
  createChatConversation,
  createChatGroup,
  getChatConversation,
  editChatMessage,
  getChatConversationDirectory as getChatConversations,
  getChatMessages,
  getChatPolicy,
  getChatRecipients,
  markChatRead,
  sendChatMessage,
  type ChatConversation,
  type ChatMessage,
} from "./api";

vi.mock("./api", async (original) => {
  const actual = await original<typeof import("./api")>();
  return {
    ...actual,
    createChatConversation: vi.fn(),
    createChatGroup: vi.fn(),
    editChatMessage: vi.fn(),
    getChatConversation: vi.fn(),
    getChatConversationDirectory: vi.fn(),
    getChatMessages: vi.fn(),
    getChatPolicy: vi.fn(),
    getChatRecipients: vi.fn(),
    markChatRead: vi.fn(),
    reportChatMessage: vi.fn(),
    sendChatMessage: vi.fn(),
  };
});

const identity = vi.hoisted(() => ({ account: "account-a", world: "live:school-a" }));
vi.mock("../auth/AuthContext", () => ({
  useOptionalAuth: () => ({ user: { id: identity.account, display_name: "Pooja Sharma" } }),
}));
vi.mock("../simulation/ExecutionEnvironmentContext", () => ({
  useOptionalExecutionEnvironment: () => ({ mode: identity.world.startsWith("live") ? "live" : "simulation", namespaceId: identity.world, institutionId: "school-a" }),
}));

const selectedConversation: ChatConversation = {
  id: "conversation-101",
  school_id: "school-1",
  kind: "group",
  title: "Archived family thread",
  other_role: "staff",
  avatar_url: null,
  context_student_id: "child-1",
  student_name: "Aarav Sharma",
  last_message: "Please review the update.",
  last_message_at: "2026-10-01T08:00:00.000Z",
  unread_count: 1,
  group_type: "announcement",
  posting_mode: "moderators",
  participant_role: "member",
  member_count: 20,
  can_post: false,
};

function conversation(index: number): ChatConversation {
  return {
    ...selectedConversation,
    id: `conversation-${index}`,
    title: `Conversation ${index}`,
    context_student_id: null,
    student_name: null,
    posting_mode: "all",
    participant_role: "member",
    can_post: true,
  };
}

const dependentContext: ChatWorkspaceContext = {
  kind: "dependent",
  label: "Aarav's conversations",
  studentId: "child-1",
  canCreateGroups: false,
};

function show(context: ChatWorkspaceContext = dependentContext, path = "/areas/messages/conversations?conversation=conversation-101&scope=dependent&student_id=child-1", client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <ChatExperience context={context} />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}</output>;
}

function message(id: string, createdAt: string): ChatMessage {
  return { id, conversation_id: "conversation-101", sender_id: "staff-1", sender_name: "Campus team", sender_role: "staff", body: `Message ${id}`, message_type: "text", reply_to_id: null, is_deleted: false, is_mine: false, is_reported_by_me: false, report_status: null, created_at: createdAt, updated_at: createdAt, attachment: null };
}

beforeEach(() => {
  identity.account = "account-a"; identity.world = "live:school-a";
  vi.mocked(markChatRead).mockResolvedValue({});
  vi.mocked(getChatRecipients).mockResolvedValue({ results: [] });
  vi.mocked(createChatConversation).mockReset();
  vi.mocked(createChatGroup).mockReset();
  vi.mocked(getChatConversations).mockResolvedValue({
    // The selected thread is intentionally absent, which is the behavior this
    // test needs. A small capped projection avoids spending the CI timeout on
    // accessibility-tree traversal through 100 otherwise identical rows.
    results: Array.from({ length: 8 }, (_, index) => conversation(index)),
    has_more: false, next_cursor: null,
  });
  vi.mocked(getChatMessages).mockResolvedValue({ results: [], has_more: false });
  vi.mocked(getChatPolicy).mockResolvedValue({
    school_id: "school-1",
    student_teacher_direct_enabled: true,
    guardian_teacher_direct_enabled: true,
    student_group_replies: true,
    guardian_group_replies: true,
    attachments_enabled: true,
    enforce_communication_hours: false,
    communication_start: "08:00",
    communication_end: "18:00",
    retention_days: 455,
    timezone: "Asia/Kolkata",
    revision: 0,
    can_manage: false,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("exact selected chat conversation", () => {
  it("merges a selected conversation outside the capped list and uses its posting permission", async () => {
    vi.mocked(getChatConversation).mockResolvedValue(selectedConversation);

    show();

    const selectedRow = await screen.findByRole("button", { name: /Archived family thread/ });
    expect(selectedRow).toHaveClass("is-active");
    expect(getChatConversation).toHaveBeenCalledWith("conversation-101", "child-1");
    expect(await screen.findByText("Posting is restricted")).toBeVisible();
    expect(screen.queryByPlaceholderText("Write a message…")).not.toBeInTheDocument();
    await waitFor(() => expect(vi.mocked(getChatMessages).mock.calls.some(([id, cursor, options]) => id === "conversation-101" && cursor === undefined && options?.signal instanceof AbortSignal)).toBe(true));
  });

  it("keeps messages and the composer closed until exact metadata is authorized", async () => {
    let rejectDetail!: (reason: Error) => void;
    vi.mocked(getChatConversation).mockImplementation(() => new Promise((_resolve, reject) => {
      rejectDetail = reject;
    }));

    show();

    expect(await screen.findByText("Checking access and messaging settings")).toBeVisible();
    expect(screen.queryByPlaceholderText("Write a message…")).not.toBeInTheDocument();
    expect(getChatMessages).not.toHaveBeenCalled();

    act(() => rejectDetail(new Error("Conversation not found.")));

    expect(await screen.findByRole("heading", { name: "Conversation could not be opened" })).toBeVisible();
    expect(screen.queryByPlaceholderText("Write a message…")).not.toBeInTheDocument();
    expect(getChatMessages).not.toHaveBeenCalled();
  });

  it("replaces stale list metadata with the exact selected projection", () => {
    const stale = { ...selectedConversation, title: "Stale title", can_post: true };
    const merged = mergeSelectedConversation([conversation(1), stale], selectedConversation);

    expect(merged).toHaveLength(2);
    expect(merged[1]).toEqual(selectedConversation);
  });
});

describe("manifest-composed chat actions", () => {
  it("shows governed group creation only when the selected surface contributes it", async () => {
    show({ kind: "responsibility", label: "Campus conversations", canCreateGroups: true }, "/areas/messages/conversations");

    expect(await screen.findByRole("button", { name: "Create group" })).toBeInTheDocument();

    cleanup();
    show(dependentContext, "/areas/messages/conversations?scope=dependent&student_id=child-1");
    expect(screen.queryByRole("button", { name: "Create group" })).not.toBeInTheDocument();
  });

  it("keeps the messaging policy correction path on a canonical setup route", async () => {
    vi.mocked(getChatPolicy).mockResolvedValue({
      school_id: "school-1",
      student_teacher_direct_enabled: true,
      guardian_teacher_direct_enabled: true,
      student_group_replies: true,
      guardian_group_replies: true,
      attachments_enabled: true,
      enforce_communication_hours: false,
      communication_start: "08:00",
      communication_end: "18:00",
      retention_days: 455,
      timezone: "Asia/Kolkata",
      revision: 0,
      can_manage: true,
    });
    show({ kind: "responsibility", label: "Campus conversations", canCreateGroups: true }, "/areas/messages/conversations");

    await waitFor(() => expect(getChatPolicy).toHaveBeenCalled());
    screen.getByRole("button", { name: "Messaging privacy" }).click();

    expect(await screen.findByRole("link", { name: "Messaging operating rules" })).toHaveAttribute(
      "href",
      "/more/setup/institution/operating-rules?school=school-1&rule=messages",
    );
    expect(screen.getByText("Automatic message deletion is not enabled.")).toBeInTheDocument();
    expect(screen.queryByText(/Messages follow school retention policy/)).not.toBeInTheDocument();
  });

  it("explains the server's campus policy restriction rather than claiming moderator-only access", async () => {
    vi.mocked(getChatConversation).mockResolvedValue({ ...selectedConversation,
      can_post: false, posting_restriction: "Messaging is available 08:00–18:00 (Asia/Kolkata). You can still read or report messages." });
    show();
    expect(await screen.findByText(/Messaging is available 08:00/)).toBeInTheDocument();
    expect(screen.queryByText("Only approved moderators can post.")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send message" })).not.toBeInTheDocument();
  });

  it("explains a new-conversation refusal without losing the contact search", async () => {
    vi.mocked(getChatRecipients).mockResolvedValue({ results: [{ id: "teacher-1", name: "Meera Teacher", role: "staff", membership_role: "staff", school_id: "school-1", school_name: "Riverview", detail: "Teacher", student_id: null, avatar_url: null }] });
    vi.mocked(createChatConversation).mockRejectedValue(new Error("Messaging is available 08:00–18:00."));
    show();
    fireEvent.click(screen.getByRole("button", { name: "Start a new message" }));
    fireEvent.change(screen.getByPlaceholderText("Search teachers or school staff"), { target: { value: "Meera" } });
    fireEvent.click(await screen.findByRole("button", { name: /Meera Teacher/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Messaging is available 08:00–18:00.");
    expect(screen.getByPlaceholderText("Search teachers or school staff")).toHaveValue("Meera");
    expect(screen.getByRole("dialog", { name: "New message" })).toBeInTheDocument();
  });

  it("shows recipient-load failure as a retryable error, not an empty directory", async () => {
    vi.mocked(getChatRecipients).mockRejectedValue(new Error("Contacts could not be loaded."));
    show();
    fireEvent.click(screen.getByRole("button", { name: "Start a new message" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Contacts could not be loaded.");
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.queryByText("No approved contacts match your search.")).not.toBeInTheDocument();
  });

  it("retains group name and member choices when creation is refused", async () => {
    vi.mocked(getChatRecipients).mockResolvedValue({ results: [{ id: "learner-1", name: "Sana Learner", role: "student", membership_role: "student", school_id: "school-1", school_name: "Riverview", detail: "Learner", student_id: "learner-record", avatar_url: null }] });
    vi.mocked(createChatGroup).mockRejectedValue(new Error("Group access changed. Reload before trying again."));
    show({ kind: "responsibility", label: "Campus conversations", canCreateGroups: true });
    fireEvent.click(screen.getByRole("button", { name: "Create group" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Create group" }));
    fireEvent.change(dialog.getByLabelText("Group name"), { target: { value: "Robotics" } });
    fireEvent.click(await dialog.findByRole("checkbox", { name: /Sana Learner/ }));
    fireEvent.click(dialog.getByRole("button", { name: "Create group" }));
    expect(await dialog.findByRole("alert")).toHaveTextContent("Group access changed");
    expect(dialog.getByLabelText("Group name")).toHaveValue("Robotics");
    expect(dialog.getByRole("checkbox", { name: /Sana Learner/ })).toBeChecked();
    expect(getChatRecipients).toHaveBeenCalledWith(undefined, "group");
  });
});

describe("mobile conversation recovery and history", () => {
  it("searches beyond the current directory page and preserves page/search on thread Back", async () => {
    const client = new QueryClient({defaultOptions:{queries:{retry:false}}});
    vi.mocked(getChatConversations).mockImplementation(input => Promise.resolve(input.search ? {
      results: [{...conversation(103),title:"Old authorized target"}],has_more:false,next_cursor:null,
    } : input.cursor ? {results:[conversation(2)],has_more:false,next_cursor:null} : {results:[conversation(1)],has_more:true,next_cursor:"directory-next"}));
    vi.mocked(getChatConversation).mockResolvedValue(conversation(2));
    const view = show(dependentContext,"/areas/messages/conversations?scope=dependent&student_id=child-1",client);
    await screen.findByText("Conversation 1",{exact:true});
    fireEvent.click(screen.getByText("Next",{selector:"button"}));
    fireEvent.click(await screen.findByText("Conversation 2",{exact:true}));
    await screen.findByLabelText("Back to conversations");
    fireEvent.click(screen.getByLabelText("Back to conversations"));
    expect(screen.getByText("Page 2")).toBeInTheDocument();
    expect(screen.getByLabelText("Search conversations")).toHaveValue("");
    fireEvent.change(screen.getByLabelText("Search conversations"),{target:{value:"unique-old-target"}});
    expect(await screen.findByText("Old authorized target",{exact:true})).toBeInTheDocument();
    expect(screen.getByText("Page 1")).toBeInTheDocument();
    expect(getChatConversations).toHaveBeenLastCalledWith({search:"unique-old-target",cursor:undefined,studentId:"child-1"});
    expect(screen.queryByText("Conversation 1",{exact:true})).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Old authorized target",{exact:true}));
    await screen.findByLabelText("Back to conversations");
    fireEvent.click(screen.getByLabelText("Back to conversations"));
    expect(screen.getByLabelText("Search conversations")).toHaveValue("unique-old-target");
    expect(screen.getByText("Old authorized target",{exact:true})).toBeInTheDocument();
    view.unmount();
    show(dependentContext,"/areas/messages/conversations?scope=dependent&student_id=child-1",client);
    expect(screen.getByLabelText("Search conversations")).toHaveValue("unique-old-target");
    expect(await screen.findByText("Old authorized target",{exact:true})).toBeInTheDocument();
    cleanup(); client.clear();
  });

  it("shows stale directory refresh failure but hides the page after authorization is denied", async () => {
    const client = new QueryClient({defaultOptions:{queries:{retry:false}}});
    show(dependentContext,"/areas/messages/conversations?scope=dependent&student_id=child-1",client);
    await screen.findByText("Conversation 1",{exact:true});
    vi.mocked(getChatConversations).mockRejectedValue(new Error("Temporary network failure"));
    await act(() => client.invalidateQueries({queryKey:["chat","conversations"]}));
    expect(await screen.findByText(/Conversations could not be refreshed/)).toBeInTheDocument();
    expect(screen.getByText("Conversation 1",{exact:true})).toBeInTheDocument();
    vi.mocked(getChatConversations).mockRejectedValue(new ApiError("Access revoked",403));
    await act(() => client.invalidateQueries({queryKey:["chat","conversations"]}));
    await waitFor(() => expect(screen.queryByText("Conversation 1",{exact:true})).not.toBeInTheDocument());
    expect(screen.queryByText(/last verified page/)).not.toBeInTheDocument();
    cleanup(); client.clear();
  });

  it("returns from an unavailable thread without losing its selected child scope", async () => {
    vi.mocked(getChatConversation).mockRejectedValue(new Error("Access changed"));
    show();
    expect(await screen.findByRole("heading", { name: "Conversation could not be opened" })).toBeVisible();
    fireEvent.click(screen.getByLabelText("Back to conversations"));
    expect(screen.getByTestId("location")).toHaveTextContent("/areas/messages/conversations?scope=dependent&student_id=child-1");
    expect(screen.queryByRole("button", { name: "Back to conversations" })).not.toBeInTheDocument();
  });

  it("sends an attachment without forcing meaningless message text", async () => {
    vi.mocked(getChatConversation).mockResolvedValue({ ...selectedConversation, can_post: true });
    vi.mocked(sendChatMessage).mockResolvedValue({ id: "sent-file" });
    const user = userEvent.setup();
    show();
    expect(await screen.findByRole("textbox", { name: "Write a message" })).toBeVisible();
    const file = new File(["test attachment"], "campus-note.pdf", { type: "application/pdf" });
    fireEvent.change(screen.getByLabelText("Attach a file", { selector: "input" }), { target: { files: [file] } });
    await user.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(sendChatMessage).toHaveBeenCalledTimes(1));
    const [conversationId, submitted] = vi.mocked(sendChatMessage).mock.calls[0]!;
    expect(conversationId).toBe("conversation-101");
    expect(submitted.body).toBe("");
    expect(submitted.file).toBe(file);
    expect(typeof submitted.clientId).toBe("string");
  });

  it("loads earlier authorized messages through the existing explicit cursor control", async () => {
    vi.mocked(getChatConversation).mockResolvedValue(selectedConversation);
    const latest = message("latest", "2026-10-20T10:00:00.000Z");
    const earlier = message("earlier", "2026-10-19T10:00:00.000Z");
    vi.mocked(getChatMessages).mockImplementation((_id, cursor) => Promise.resolve(cursor ? { results: [earlier], has_more: false, next_cursor: null } : { results: [latest], has_more: true, next_cursor: "opaque-earlier-cursor" }));
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole("button", { name: "Earlier messages" }));
    expect(await screen.findByText("Message earlier")).toBeVisible();
    expect(screen.getByText("Message latest")).toBeVisible();
    expect(vi.mocked(getChatMessages).mock.calls.some(([id, cursor, options]) => id === "conversation-101" && cursor === "opaque-earlier-cursor" && options?.signal instanceof AbortSignal)).toBe(true);
    expect(screen.queryByRole("button", { name: "Earlier messages" })).not.toBeInTheDocument();
  });

  it("keeps the loaded conversation visible when earlier history fails and offers retry", async () => {
    vi.mocked(getChatConversation).mockResolvedValue(selectedConversation);
    const latest = message("latest", "2026-10-20T10:00:00.000Z");
    vi.mocked(getChatMessages).mockImplementation((_id, cursor) => cursor ? Promise.reject(new Error("History is unavailable")) : Promise.resolve({ results: [latest], has_more: true, next_cursor: "opaque-earlier-cursor" }));
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole("button", { name: "Earlier messages" }));
    expect(await screen.findByRole("button", { name: "Try loading earlier messages again" })).toBeVisible();
    expect(screen.getByText("Message latest")).toBeVisible();
  });

  it("preserves the server order when distinct microseconds serialize to one millisecond", async () => {
    vi.mocked(getChatConversation).mockResolvedValue(selectedConversation);
    vi.mocked(getChatMessages).mockResolvedValue({ results: [message("z", "2026-10-20T10:00:00.123Z"), message("a", "2026-10-20T10:00:00.123Z")], has_more: false, next_cursor: null });
    const view = show();
    await screen.findByText("Message a");
    expect([...view.container.querySelectorAll(".chat-bubble p")].map(node => node.textContent)).toEqual(["Message z", "Message a"]);
  });

  it("fails closed when an earlier-page request reports lost authorization", async () => {
    vi.mocked(getChatConversation).mockResolvedValue({ ...selectedConversation, can_post: true });
    vi.mocked(getChatMessages).mockImplementation((_id, cursor) => cursor ? Promise.reject(new ApiError("Access revoked", 403)) : Promise.resolve({ results: [message("private", "2026-10-20T10:00:00.000Z")], has_more: true, next_cursor: "earlier" }));
    show();
    await userEvent.click(await screen.findByRole("button", { name: "Earlier messages" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Conversation access changed");
    expect(screen.queryByText("Message private")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Write a message" })).not.toBeInTheDocument();
  });

  it("keeps verified history with an explicit stale warning after a transient refresh failure", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.mocked(getChatConversation).mockResolvedValue(selectedConversation);
    vi.mocked(getChatMessages).mockResolvedValue({ results: [message("verified", "2026-10-20T10:00:00.000Z")], has_more: false });
    show(dependentContext, undefined, client);
    await screen.findByText("Message verified");
    vi.mocked(getChatMessages).mockRejectedValue(new Error("Network interrupted"));
    await act(() => client.invalidateQueries({ queryKey: ["chat", "messages"] }));
    expect(await screen.findByText(/Messages could not be refreshed/)).toBeVisible();
    expect(screen.getByText("Message verified")).toBeVisible();
    cleanup(); client.clear();
  });

  it("offers an explicit recent-message rebase without silently discarding the verified view", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.mocked(getChatConversation).mockResolvedValue(selectedConversation);
    vi.mocked(getChatMessages).mockResolvedValue({ results: [message("verified", "2026-10-20T10:00:00.000Z")], has_more: false, boundary_cursor: "retained-frontier" });
    show(dependentContext, undefined, client);
    await screen.findByText("Message verified");
    vi.mocked(getChatMessages).mockRejectedValue(new ChatHistoryRefreshLimitError());
    await act(() => client.invalidateQueries({ queryKey: ["chat", "messages"] }));
    expect(await screen.findByText(/Your loaded history needs a fresh start/)).toBeVisible();
    expect(screen.getByText("Message verified")).toBeVisible();
    vi.mocked(getChatMessages).mockResolvedValue({ results: [message("recent", "2026-10-20T11:00:00.000Z")], has_more: false, boundary_cursor: "recent-frontier" });
    fireEvent.click(screen.getByText("Show recent messages", { selector: "button" }));
    expect(await screen.findByText("Message recent")).toBeVisible();
    expect(screen.queryByText("Message verified")).not.toBeInTheDocument();
    expect(vi.mocked(getChatMessages).mock.calls.at(-1)?.[2]?.throughCursor).toBeUndefined();
    cleanup(); client.clear();
  });

  it.each(["account", "world", "child"])("clears the displayed history and draft immediately when the %s scope changes", async (change) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.mocked(getChatConversation).mockResolvedValueOnce({ ...selectedConversation, can_post: true }).mockImplementation(() => new Promise(() => {}));
    vi.mocked(getChatMessages).mockResolvedValue({ results: [message("old-private", "2026-10-20T10:00:00.000Z")], has_more: false, boundary_cursor: "old-frontier" });
    const view = show(dependentContext, undefined, client);
    await screen.findByText("Message old-private");
    fireEvent.change(screen.getByRole("textbox", { name: "Write a message" }), { target: { value: "Old scope draft" } });
    if (change === "account") identity.account = "account-b";
    if (change === "world") identity.world = "scenario:second:run:second";
    const nextContext = change === "child" ? { ...dependentContext, studentId: "child-2" } : dependentContext;
    view.rerender(<QueryClientProvider client={client}><MemoryRouter><ChatExperience context={nextContext} /><LocationProbe /></MemoryRouter></QueryClientProvider>);
    expect(screen.queryByText("Message old-private")).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("Old scope draft")).not.toBeInTheDocument();
    expect(getChatMessages).toHaveBeenCalledTimes(1);
    cleanup(); client.clear();
  });

  it("retains the explicitly loaded oldest message when Send invalidates the refreshed newest head", async () => {
    const rows = Array.from({ length: 120 }, (_, index) => message(String(index + 1), "2026-10-20T10:00:00.123Z"));
    vi.mocked(getChatConversation).mockResolvedValue({ ...selectedConversation, can_post: true });
    vi.mocked(getChatMessages).mockImplementation((_id, cursor, options) => {
      const eligible = rows.filter(row => !cursor || Number(row.id) < Number(cursor));
      const native = eligible.slice(-50);
      const target = options?.throughCursor;
      const reached = Boolean(target && Number(native[0]?.id ?? 0) <= Number(target));
      const results = reached ? native.filter(row => Number(row.id) >= Number(target)) : native;
      const boundary = reached ? target : results[0]?.id;
      const hasMore = eligible.some(row => Number(row.id) < Number(boundary));
      return Promise.resolve({ results, has_more: hasMore, next_cursor: hasMore ? boundary : null, boundary_cursor: boundary, reached_through: reached });
    });
    vi.mocked(sendChatMessage).mockImplementation(() => { rows.push(message("121", "2026-10-20T10:00:00.124Z")); return Promise.resolve({ id: "121" }); });
    show();
    fireEvent.click(await screen.findByText("Earlier messages", { selector: "button" }));
    await screen.findByText("Message 21", { exact: true });
    fireEvent.change(screen.getByLabelText("Write a message"), { target: { value: "New update" } });
    fireEvent.click(screen.getByLabelText("Send message"));
    await screen.findByText("Message 121", { exact: true });
    expect(screen.getByText("Message 21", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("Message 120", { exact: true })).toBeInTheDocument();
  }, 10_000);

  it("does not let pending send completion erase text or attachments entered meanwhile", async () => {
    vi.mocked(getChatConversation).mockResolvedValue({ ...selectedConversation, can_post: true });
    let complete!: (value: { id: string }) => void;
    vi.mocked(sendChatMessage).mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    const user = userEvent.setup();
    show();
    const composer = await screen.findByRole("textbox", { name: "Write a message" });
    await user.type(composer, "Campus update");
    await user.click(screen.getByRole("button", { name: "Send message" }));
    expect(composer).toBeDisabled();
    expect(screen.getByLabelText("Attach a file", { selector: "input" })).toBeDisabled();
    act(() => complete({ id: "sent" }));
    await waitFor(() => expect(composer).toBeEnabled());
    expect(composer).toHaveValue("");
  });

  it("shows a failed edit without losing the text or accepting an unsupported new attachment", async () => {
    vi.mocked(getChatConversation).mockResolvedValue({ ...selectedConversation, can_post: true });
    vi.mocked(getChatMessages).mockResolvedValue({ results: [{ ...message("mine", "2026-10-20T10:00:00.000Z"), is_mine: true, editable_until: "2099-10-20T10:00:00.000Z" }], has_more: false, next_cursor: null });
    vi.mocked(editChatMessage).mockRejectedValue(new Error("Edit was not saved"));
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole("button", { name: "Message options" }));
    await user.click(screen.getByRole("menuitem", { name: "Edit", exact: true }));
    expect(screen.getByLabelText("Attach a file", { selector: "input" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Send message" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Edit was not saved");
    expect(screen.getByRole("textbox", { name: "Write a message" })).toHaveValue("Message mine");
  });

  it("recovers a failed read-status update without hiding the conversation or claiming success", async () => {
    vi.mocked(getChatConversation).mockResolvedValue(selectedConversation);
    vi.mocked(getChatMessages).mockResolvedValue({ results: [message("latest", "2026-10-20T10:00:00.000Z")], has_more: false, next_cursor: null });
    vi.mocked(markChatRead).mockRejectedValueOnce(new Error("Read status unavailable"));
    const user = userEvent.setup();
    show();
    expect(await screen.findByText(/Read status could not be updated/)).toBeVisible();
    expect(screen.getByText("Message latest")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Try again", exact: true }));
    await waitFor(() => expect(screen.queryByText(/Read status could not be updated/)).not.toBeInTheDocument());
    expect(markChatRead).toHaveBeenCalledTimes(2);
  });
});
