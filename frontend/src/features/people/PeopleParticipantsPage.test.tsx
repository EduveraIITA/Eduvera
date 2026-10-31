import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import type { ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ExecutionEnvironmentProvider } from "../simulation/ExecutionEnvironmentContext";
import type { ExecutionEnvironment } from "../simulation/executionEnvironment";
import { PeopleParticipantsPage } from "./PeopleParticipantsPage";
import { PeopleGroupDetailPage } from "./PeopleGroupDetailPage";
import { createParticipant, createParticipationGroup, listParticipants, listCampusGroups, getParticipationGroup, replaceParticipationGroupMembers, type ParticipationGroupDetail } from "./participationApi";
import { checkPeopleImportNames } from "./peopleBulkApi";
vi.mock("../auth/AuthContext", () => ({ useAuth: () => ({ user: { active_school_id: "school-1" } }), useOptionalAuth: () => ({ user: { active_school_id: "school-1" } }) }));
vi.mock("../../pages/operations/OperationsShell", () => ({ OperationsShell: ({ children, backTo }: { children: ReactNode; backTo: string }) => <><Link to={backTo}>Back</Link>{children}</> }));
vi.mock("./participationApi", async original => ({ ...await original<typeof import("./participationApi")>(), listParticipants: vi.fn(), listCampusGroups: vi.fn(), getParticipationGroup: vi.fn(), listParticipationGroups: vi.fn(), createParticipationGroup: vi.fn(), createParticipant: vi.fn(), replaceParticipationGroupMembers: vi.fn(), getParticipant: vi.fn(), correctParticipantName: vi.fn() }));
vi.mock("./peopleBulkApi", () => ({ checkPeopleImportNames: vi.fn() }));
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });
function mount(path = "/areas/people/participants", environment: ExecutionEnvironment = { mode: "live" }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><ExecutionEnvironmentProvider environment={environment}><MemoryRouter initialEntries={[path]}><Routes><Route path="/areas" element={<p>Areas index</p>} /><Route path="/areas/people/participants/:personId" element={<p>Canonical person profile</p>} /><Route path="/areas/people/groups/:groupId" element={<PeopleGroupDetailPage />} /><Route path="*" element={<PeopleParticipantsPage />} /></Routes></MemoryRouter></ExecutionEnvironmentProvider></QueryClientProvider>);
}
const groupDetail = (patch: Partial<ParticipationGroupDetail> = {}): ParticipationGroupDetail => ({ id: "group-1", name: "Mixed campus group", revision: 4, is_active: true, members: [], member_ids: [], member_count: 0, parent: null, parent_history: [], page: 1, page_size: 25, total: 0, capabilities: { can_manage: true }, ...patch });
describe("campus people and reusable groups", () => {
  it("leaves People through Back instead of returning to its own redirect, and hides unauthorized secondary enrollment actions", async () => {
    vi.mocked(listParticipants).mockResolvedValue({ page: 1, page_size: 25, total: 0, capabilities: { can_invite: false, can_manage_enrollment: false }, results: [] });
    mount(); await screen.findByText("No people yet");
    expect(screen.queryByLabelText("More actions")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back" })).toHaveAttribute("href", "/areas");
    await userEvent.click(screen.getByRole("link", { name: "Back" }));
    expect(screen.getByText("Areas index")).toBeVisible();
  });
  it("keeps a compact visible Add action with its full accessible name and authorized secondary actions", async () => {
    vi.mocked(listParticipants).mockResolvedValue({ page: 1, page_size: 25, total: 0, capabilities: { can_invite: false, can_manage_enrollment: true }, results: [] });
    mount(); await screen.findByText("No people yet");
    const more = screen.getByLabelText("More actions");
    expect(more.tagName).toBe("SUMMARY");
    expect(more).toHaveAttribute("title", "More actions");
    expect(more.textContent).toBe("");
    expect(more.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    const add = screen.getByRole("button", { name: "Add people" });
    expect(add).toHaveTextContent(/^Add$/);
    expect(add.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(within(add.closest("header")!).getByRole("heading", { name: "People & groups", level: 1 })).toBeVisible();
    expect(screen.queryByText(/Add once\. Connect/)).not.toBeInTheDocument();
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    await userEvent.click(more);
    expect(screen.getByRole("link", { name: "Enroll from file" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Enrollment records" })).toBeVisible();
  });
  it("reveals labelled focused search, submits against the full server directory, and clears without hiding the control", async () => {
    vi.mocked(listParticipants).mockImplementation((_school, query = "", page = 1) => Promise.resolve({ page, page_size: 25, total: query ? 1 : 26, results: [{ id: "person", label: query ? "Aarav Sharma" : "Campus Member", affiliations: [], has_account: false }] }));
    mount(); await screen.findByText("Campus Member");
    await userEvent.click(screen.getByRole("button", { name: "Search" }));
    const input = screen.getByRole("searchbox", { name: "Search people" });
    expect(input).toHaveFocus();
    expect(screen.getByRole("button", { name: "Search" })).toHaveAttribute("aria-expanded", "true");
    await userEvent.type(input, " Aarav ");
    await userEvent.click(screen.getByRole("button", { name: "Apply search" }));
    await screen.findByText("Aarav Sharma");
    expect(listParticipants).toHaveBeenLastCalledWith("school-1", "Aarav", 1);
    expect(input).toHaveValue("Aarav");
    await userEvent.click(screen.getByRole("button", { name: "Clear" }));
    await screen.findByText("Campus Member");
    expect(input).toHaveValue("");
    expect(input).toHaveFocus();
    expect(listParticipants).toHaveBeenLastCalledWith("school-1", "", 1);
  });
  it("keeps a bookmarked active filter visible and removes it when Search is closed", async () => {
    vi.mocked(listParticipants).mockImplementation((_school, query = "", page = 1) => Promise.resolve({ page, page_size: 25, total: query ? 26 : 1, results: [{ id: "person", label: "Aarav Sharma", affiliations: [], has_account: false }] }));
    mount("/areas/people/participants?search=Aarav&page=2");
    await screen.findByText("Aarav Sharma");
    expect(screen.getByRole("searchbox", { name: "Search people" })).toHaveValue("Aarav");
    expect(screen.getByRole("button", { name: "Clear" })).toBeVisible();
    expect(listParticipants).toHaveBeenLastCalledWith("school-1", "Aarav", 2);
    await userEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(listParticipants).toHaveBeenLastCalledWith("school-1", "", 1));
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Search" })).toHaveFocus();
  });
  it("cancels an unapplied search with Escape without losing the current directory page", async () => {
    vi.mocked(listParticipants).mockResolvedValue({ page: 2, page_size: 25, total: 26, results: [{ id: "person", label: "Last Page Member", affiliations: [], has_account: false }] });
    mount("/areas/people/participants?page=2"); await screen.findByText("Last Page Member");
    await userEvent.click(screen.getByRole("button", { name: "Search" }));
    await userEvent.type(screen.getByRole("searchbox", { name: "Search people" }), "Not applied");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    expect(screen.getByText("Page 2 of 2")).toBeVisible();
    expect(screen.getByRole("button", { name: "Search" })).toHaveFocus();
    expect(listParticipants).toHaveBeenCalledExactlyOnceWith("school-1", "", 2);
  });
  it("resets search and page when switching views while preserving a clearly named group creation action", async () => {
    vi.mocked(listParticipants).mockResolvedValue({ page: 2, page_size: 25, total: 26, results: [] });
    vi.mocked(listCampusGroups).mockResolvedValue({ page: 1, page_size: 25, total: 0, results: [] });
    mount("/areas/people/participants?search=Aarav&page=2");
    await userEvent.click(screen.getByRole("button", { name: "Groups" }));
    await screen.findByText("No groups yet");
    expect(listCampusGroups).toHaveBeenLastCalledWith("school-1", "", 1);
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create group" })).toHaveTextContent(/^Add$/);
    expect(screen.queryByRole("navigation", { name: "Directory pages" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Search" }));
    await userEvent.type(screen.getByRole("searchbox", { name: "Search groups" }), "Workshop");
    await userEvent.click(screen.getByRole("button", { name: "Apply search" }));
    await waitFor(() => expect(listCampusGroups).toHaveBeenLastCalledWith("school-1", "Workshop", 1));
  });
  it("normalizes an invalid fractional page before requesting server results", async () => {
    vi.mocked(listParticipants).mockResolvedValue({ page: 1, page_size: 25, total: 0, results: [] });
    mount("/areas/people/participants?page=1.5"); await screen.findByText("No people yet");
    expect(listParticipants).toHaveBeenCalledExactlyOnceWith("school-1", "", 1);
  });
  it("retains a visible active filter and page through a failed load and explicit retry", async () => {
    vi.mocked(listParticipants).mockRejectedValueOnce(new Error("The directory is temporarily unavailable.")).mockResolvedValue({ page: 2, page_size: 25, total: 26, results: [{ id: "person", label: "Aarav Sharma", affiliations: [], has_account: false }] });
    mount("/areas/people/participants?search=Aarav&page=2");
    expect(await screen.findByRole("alert")).toHaveTextContent("The directory is temporarily unavailable.");
    expect(screen.getByRole("searchbox", { name: "Search people" })).toHaveValue("Aarav");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("link", { name: "Aarav Sharma" })).toBeVisible();
    expect(screen.getByText("Page 2 of 2")).toBeVisible();
    expect(listParticipants).toHaveBeenLastCalledWith("school-1", "Aarav", 2);
  });
  it("opens the canonical profile immediately after minimal name-only creation", async () => {
    vi.mocked(listParticipants).mockResolvedValue({ page: 1, page_size: 25, total: 0, results: [] });
    vi.mocked(createParticipant).mockResolvedValue({ id: "new-person", label: "Ravi", affiliations: [], has_account: false });
    vi.mocked(checkPeopleImportNames).mockResolvedValue({ results: [{ row_id: "1", name: "Ravi", normalized_name: "ravi", matches: [], total: 0, truncated: false }] });
    mount(); await screen.findByText("No people yet");
    await userEvent.click(screen.getByRole("button", { name: "Add people" }));
    const dialog = within(screen.getByRole("dialog", { name: "Add people" }));
    await userEvent.type(dialog.getByLabelText("Name"), "Ravi"); await userEvent.click(dialog.getByRole("button", { name: "Add person" }));
    expect(await screen.findByText("Canonical person profile")).toBeVisible();
    expect(vi.mocked(createParticipant).mock.calls[0]![1]).toEqual(expect.objectContaining({ first_name: "Ravi", last_name: "" }));
    expect(vi.mocked(createParticipant).mock.calls[0]![1]).not.toHaveProperty("email");
  });
  it("keeps directory names as the navigable row title and decorative icons out of accessible names", async () => {
    vi.mocked(listParticipants).mockResolvedValue({ page: 1, page_size: 25, total: 1, capabilities: { can_invite: false }, results: [
      { id: "learner", label: "Aarav Sharma", affiliations: ["learner"], has_account: false },
    ] });
    mount();
    const personLink = await screen.findByRole("link", { name: "Aarav Sharma" });
    expect(personLink).toHaveClass("person-directory-link");
    expect(personLink).toHaveAttribute("href", "/areas/people/participants/learner");
    expect(personLink.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(personLink).toHaveAccessibleDescription("learner · No app account");
    expect(screen.getByRole("button", { name: "Search" }).querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "People" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Groups" })).toHaveAttribute("aria-pressed", "false");
  });
  it("shows the linked owner as You after a name correction, and offers app access only to an unlinked person", async () => {
    vi.mocked(listParticipants).mockResolvedValue({ page: 1, page_size: 25, total: 3, capabilities: { can_invite: true }, results: [
      { id: "owner", label: "Abhishek Yadav", affiliations: [], has_account: true, account_state: "active", is_you: true },
      { id: "learner", label: "Aarav Sharma", affiliations: ["learner"], has_account: false, account_state: "not_linked", is_you: false },
      { id: "inactive", label: "Former Member", affiliations: [], has_account: true, account_state: "inactive", is_you: false },
    ] });
    mount();
    expect(await screen.findByText("Campus person · App account · You")).toBeVisible();
    expect(screen.getByText("learner · No app account")).toBeVisible();
    expect(screen.getByText("Campus person · App access inactive")).toBeVisible();
    expect(screen.getByRole("button", { name: "Invite to app for Aarav Sharma" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Invite to app for Aarav Sharma" })).toHaveTextContent(/^Invite$/);
    expect(screen.getByRole("link", { name: "Aarav Sharma" })).toHaveAccessibleDescription("learner · No app account");
    expect(screen.getByRole("link", { name: "Aarav Sharma" })).not.toContainElement(screen.getByRole("button", { name: "Invite to app for Aarav Sharma" }));
    expect(screen.queryByRole("button", { name: "Invite to app for Abhishek Yadav" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Invite to app for Former Member" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Invite to app for Aarav Sharma" }));
    const dialog = within(screen.getByRole("dialog", { name: "Invite to app" }));
    expect(dialog.getByText("Aarav Sharma")).toBeVisible();
    expect(dialog.getByLabelText("Recipient email")).toHaveValue("");
    expect(dialog.queryByLabelText(/role|account type|password/i)).not.toBeInTheDocument();
  });
  it("shows pending invitation status and its existing management action without claiming an app account", async () => {
    vi.mocked(listParticipants).mockResolvedValue({ page: 1, page_size: 25, total: 1, capabilities: { can_invite: true }, results: [
      { id: "learner", label: "Aarav Sharma", affiliations: ["learner"], has_account: false, account_state: "not_linked", pending_invitation: { id: "invitation", state: "pending", expires_at: "2099-10-20T12:00:00Z" } },
    ] });
    mount();
    expect(await screen.findByText("learner · Invitation pending")).toBeVisible();
    expect(screen.getByRole("button", { name: "Manage invitation for Aarav Sharma" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Manage invitation for Aarav Sharma" })).toHaveTextContent(/^Manage$/);
    expect(screen.queryByRole("button", { name: "Invite to app for Aarav Sharma" })).not.toBeInTheDocument();
  });
  it("does not infer invitation authority from access to the People directory", async () => {
    vi.mocked(listParticipants).mockResolvedValue({ page: 1, page_size: 25, total: 1, capabilities: { can_invite: false }, results: [
      { id: "learner", label: "Aarav Sharma", affiliations: [], has_account: false, account_state: "not_linked" },
    ] });
    mount();
    expect(await screen.findByText("Aarav Sharma")).toBeVisible();
    expect(screen.queryByRole("button", { name: /Invite to app|Manage invitation/ })).not.toBeInTheDocument();
  });
  it("explains Live-only app access in Simulation even if an old captured capability says invite", async () => {
    vi.mocked(listParticipants).mockResolvedValue({ page: 1, page_size: 25, total: 1, capabilities: { can_invite: true }, results: [
      { id: "learner", label: "Aarav Sharma", affiliations: [], has_account: false, account_state: "not_linked" },
    ] });
    mount("/areas/people/participants", { mode: "simulation", namespaceId: "namespace", runId: "run", runStatus: "running", virtualClock: { now: "2026-10-20T12:00:00Z", timeZone: "UTC" } });
    expect(await screen.findByText("Aarav Sharma")).toBeVisible();
    expect(screen.getByText(/App access is managed in Live/)).toBeVisible();
    expect(screen.queryByRole("button", { name: /Invite to app|Manage invitation/ })).not.toBeInTheDocument();
  });
  it("keeps a completed Simulation directory browsable with both creation actions disabled", async () => {
    vi.mocked(listParticipants).mockResolvedValue({ page: 1, page_size: 25, total: 1, capabilities: { can_invite: true }, results: [{ id: "person", label: "Captured Person", affiliations: [], has_account: false }] });
    vi.mocked(listCampusGroups).mockResolvedValue({ page: 1, page_size: 25, total: 0, results: [] });
    mount("/areas/people/participants", { mode: "simulation", namespaceId: "namespace", runId: "run", runStatus: "completed", virtualClock: { now: "2026-10-20T12:00:00Z", timeZone: "UTC" } });
    await screen.findByText("Captured Person");
    expect(screen.getByRole("button", { name: "Add people" })).toBeDisabled();
    expect(screen.getByText(/saved People directory is read-only/)).toBeVisible();
    expect(screen.queryByRole("button", { name: /Invite to app|Manage invitation/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Groups" }));
    await screen.findByText("No groups yet");
    expect(screen.getByRole("button", { name: "Create group" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Search" })).toBeEnabled();
  });
  it("does not query Live people or groups when the selected Simulation is unavailable", () => {
    mount("/areas/people/participants", { mode: "simulation", namespaceId: "namespace", runId: "run", unavailable: true, unavailableReason: "run_unavailable" });
    expect(screen.getByRole("alert")).toHaveTextContent("People cannot be loaded from Live instead");
    expect(listParticipants).not.toHaveBeenCalled();
    expect(listCampusGroups).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Add people" })).not.toBeInTheDocument();
  });
  it("keeps completed-simulation group browsing read-only", async () => {
    vi.mocked(getParticipationGroup).mockResolvedValue(groupDetail({ name: "Captured group" }));
    mount("/areas/people/groups/group-1", { mode: "simulation", namespaceId: "sim-one", runId: "run-one", runStatus: "completed", virtualClock: { now: "2026-10-20T10:00:00Z", timeZone: "Asia/Kolkata" } });
    expect(await screen.findByRole("button", { name: "Edit members" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Change structure" })).toBeDisabled();
    expect(screen.getByText(/saved group is read-only/)).toBeVisible();
    expect(replaceParticipationGroupMembers).not.toHaveBeenCalled();
  });
  it("edits a dated group across finite selector pages and retains its failed command for retry", async () => {
    vi.mocked(getParticipationGroup).mockResolvedValue(groupDetail({ member_ids: ["worker"], member_count: 1, total: 1, members: [{ person_id: "worker", label: "Ravi Guard", starts_on: "2026-10-20", ends_on: null }] }));
    vi.mocked(listParticipants).mockImplementation((_school, _search, page = 1) => Promise.resolve({ page, page_size: 25, total: 26,
      results: [{ id: page === 1 ? "worker" : "learner", label: page === 1 ? "Ravi Guard" : "Aarav Learner", affiliations: [], has_account: false }] }));
    vi.mocked(replaceParticipationGroupMembers).mockRejectedValueOnce(new Error("Membership already starts on or after this date. Choose a date after 2026-10-20 rather than overwriting dated history."))
      .mockRejectedValueOnce(new Error("Connection interrupted"))
      .mockResolvedValue({ id: "group-1", revision: 5 });
    mount("/areas/people/groups/group-1");
    await userEvent.click(await screen.findByRole("button", { name: "Edit members" }));
    const dialog = within(screen.getByRole("dialog", { name: "Edit group members" }));
    expect(await dialog.findByRole("checkbox", { name: /Ravi Guard/ })).toBeChecked();
    await userEvent.click(dialog.getByRole("button", { name: "Next" }));
    await userEvent.click(await dialog.findByRole("checkbox", { name: /Aarav Learner/ }));
    expect(dialog.getByRole("status")).toHaveTextContent("2 selected across all pages");
    fireEvent.input(dialog.getByLabelText("Change from"), { target: { value: "2026-10-20" } });
    await userEvent.click(dialog.getByRole("button", { name: "Save dated membership" }));
    expect(await dialog.findByRole("alert")).toHaveTextContent("after 2026-10-20");
    expect(dialog.getByRole("checkbox", { name: /Aarav Learner/ })).toBeChecked();
    fireEvent.input(dialog.getByLabelText("Change from"), { target: { value: "2026-10-21" } });
    await userEvent.click(dialog.getByRole("button", { name: "Save dated membership" }));
    expect(await dialog.findByRole("alert")).toHaveTextContent("Connection interrupted");
    await userEvent.click(dialog.getByRole("button", { name: "Save dated membership" }));
    await waitFor(() => expect(replaceParticipationGroupMembers).toHaveBeenCalledTimes(3));
    const calls = vi.mocked(replaceParticipationGroupMembers).mock.calls;
    expect(calls[1]!.slice(0, 2)).toEqual(["school-1", "group-1"]);
    const { idempotency_key: retryKey, ...membership } = calls[1]![2];
    expect(membership).toEqual({ person_ids: ["worker", "learner"], effective_on: "2026-10-21", expected_revision: 4 });
    expect(retryKey).toMatch(/^[a-f\d-]{36}$/);
    expect(calls[1]![2].idempotency_key).not.toBe(calls[0]![2].idempotency_key);
    expect(calls[2]).toEqual(calls[1]);
    expect(await screen.findByRole("status")).toHaveTextContent("Published activities keep their captured rosters");
  });
  it("bounds an existing group's displayed members separately from directory paging", async () => {
    const members = Array.from({ length: 26 }, (_, index) => ({ person_id: `person-${index}`, label: `Member ${index}`, starts_on: "2026-10-20", ends_on: null }));
    vi.mocked(getParticipationGroup).mockImplementation((_school, _id, page = 1) => Promise.resolve(groupDetail({ name: "Large group", member_ids: members.map(member => member.person_id), member_count: 26, total: 26, page, members: members.slice((page - 1) * 25, page * 25) })));
    mount("/areas/people/groups/group-1");
    expect(await screen.findByText("Member 0")).toBeVisible();
    expect(screen.queryByText("Member 25")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Member 25")).toBeVisible();
    expect(screen.queryByText("Member 0")).not.toBeInTheDocument();
  });
  it("uses finite pages and does not require participant accounts", async () => {
    vi.mocked(listParticipants).mockImplementation((_school, _search, page = 1) => Promise.resolve({ page, page_size: 25, total: 26, results: [{ id: `person-${page}`, label: page === 1 ? "Ravi Guard" : "Aarav Learner", affiliations: [], has_account: false }] }));
    mount();
    expect(await screen.findByText("Ravi Guard")).toBeVisible();
    expect(screen.getByText(/No app account/)).toBeVisible();
    expect(screen.getByText("Page 1 of 2")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Aarav Learner")).toBeVisible();
    expect(screen.queryByText("Ravi Guard")).not.toBeInTheDocument();
    expect(listParticipants).toHaveBeenCalledWith("school-1", "", 2);
    expect(screen.getByRole("list", { name: "People" })).toHaveFocus();
  });
  it("retains mixed-person selections across pages when creating one reusable group", async () => {
    vi.mocked(listCampusGroups).mockResolvedValue({ page: 1, page_size: 25, total: 0, results: [] });
    vi.mocked(listParticipants).mockImplementation((_school, _search, page = 1) => Promise.resolve({ page, page_size: 25, total: 26, results: [{ id: page === 1 ? "worker" : "learner", label: page === 1 ? "Ravi Guard" : "Aarav Learner", affiliations: [page === 1 ? "worker" : "learner"], has_account: false }] }));
    vi.mocked(createParticipationGroup).mockResolvedValue({ id: "group-1", revision: 1 });
    mount("/areas/people/participants?view=groups");
    await userEvent.click(await screen.findByRole("button", { name: "Create group" }));
    const dialog = within(screen.getByRole("dialog", { name: "Create group" }));
    await userEvent.type(dialog.getByLabelText("Group name"), "Safety training group");
    fireEvent.input(dialog.getByLabelText("Membership starts"), { target: { value: "2026-10-20" } });
    await userEvent.click(await dialog.findByRole("checkbox", { name: /Ravi Guard/ }));
    await userEvent.click(dialog.getByRole("button", { name: "Next" }));
    await userEvent.click(await dialog.findByRole("checkbox", { name: /Aarav Learner/ }));
    expect(dialog.getByRole("status")).toHaveTextContent("2 selected across all pages");
    await userEvent.click(dialog.getByRole("button", { name: "Create group" }));
    await waitFor(() => expect(createParticipationGroup).toHaveBeenCalledTimes(1));
    const [school, body] = vi.mocked(createParticipationGroup).mock.calls[0]!;
    const { idempotency_key: retryKey, ...group } = body;
    expect(school).toBe("school-1");
    expect(group).toEqual({ name: "Safety training group", person_ids: ["worker", "learner"], starts_on: "2026-10-20", ends_on: null });
    expect(retryKey).toMatch(/^[a-f\d-]{36}$/);
  });
});
