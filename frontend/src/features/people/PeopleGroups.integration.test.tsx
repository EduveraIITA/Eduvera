import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Link, MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import type { ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ExecutionEnvironmentProvider } from "../simulation/ExecutionEnvironmentContext";
import { PeopleGroupDetailPage } from "./PeopleGroupDetailPage";
import { PeopleParticipantsPage } from "./PeopleParticipantsPage";
import { getNativeGroup, getParticipationGroup, getParticipationGroupHistory, listCampusGroups, listParticipants, listParticipationGroups, replaceParticipationGroupMembers, setParticipationGroupParent, type ParticipationGroupDetail } from "./participationApi";

vi.mock("../auth/AuthContext", () => ({ useAuth: () => ({ user: { active_school_id: "campus" } }) }));
vi.mock("../../pages/operations/OperationsShell", () => ({ OperationsShell: ({ children, title, backTo, contentHasHeading = false }: { children: ReactNode; title: string; backTo?: string; contentHasHeading?: boolean }) => <>{backTo ? <Link to={backTo}>Back</Link> : null}{!contentHasHeading ? <header><h1>{title}</h1></header> : null}<main>{children}</main></> }));
vi.mock("./participationApi", async original => ({ ...await original<typeof import("./participationApi")>(), getNativeGroup: vi.fn(), getParticipationGroup: vi.fn(), getParticipationGroupHistory: vi.fn(), listCampusGroups: vi.fn(), listParticipants: vi.fn(), listParticipationGroups: vi.fn(), replaceParticipationGroupMembers: vi.fn(), setParticipationGroupParent: vi.fn() }));
beforeAll(() => { HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); }; HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); }; });
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const group: ParticipationGroupDetail = { id: "group", name: "Campus workshop", revision: 5, is_active: true, member_ids: ["visible", "not-on-this-page"], members: [{ person_id: "visible", label: "Visible Member", starts_on: "2026-10-01", ends_on: null }], member_count: 2, parent: null, parent_history: [], page: 1, page_size: 25, total: 2, capabilities: { can_manage: true } };
function GroupNavigation({ destination }: { destination: string }) { const navigate = useNavigate(); return <button type="button" onClick={() => void navigate(destination)}>Navigate to another group</button>; }
function mount(path: string, destination?: string, returnTo?: string) { render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ExecutionEnvironmentProvider environment={{ mode: "live" }}><MemoryRouter initialEntries={[{ pathname: path.split("?")[0], search: path.includes("?") ? `?${path.split("?").slice(1).join("?")}` : "", state: returnTo ? { peopleReturnTo: returnTo } : undefined }]}>{destination ? <GroupNavigation destination={destination} /> : null}<Routes><Route path="/areas/people/participants" element={<PeopleParticipantsPage />} /><Route path="/areas/people/groups/:groupId" element={<PeopleGroupDetailPage />} /></Routes></MemoryRouter></ExecutionEnvironmentProvider></QueryClientProvider>); }
describe("bounded typed campus groups", () => {
  it.each(["participation", "class", "organization"] as const)("returns from a %s group to the exact originating person view and page", async kind => {
    vi.mocked(getParticipationGroup).mockResolvedValue(group);
    if (kind !== "participation") vi.mocked(getNativeGroup).mockResolvedValue({ id: "group", kind, name: group.name, members: [], member_count: 2, page: 1, page_size: 25, total: 2, source_href: null });
    const origin = "/areas/people/participants/person-id?profile_view=groups&group_page=2";
    mount(`/areas/people/groups/group${kind === "participation" ? "" : `?kind=${kind}`}`, undefined, origin);
    await screen.findByRole("heading", { name: group.name });
    expect(screen.getByRole("link", { name: "Back" })).toHaveAttribute("href", origin);
  });
  it.each(["https://example.test/", "//example.test/", "/areas/people/participants/../security", "/areas/people/participants/one/nested"])("rejects an out-of-scope group return target %s", async origin => {
    vi.mocked(getParticipationGroup).mockResolvedValue(group);
    mount("/areas/people/groups/group", undefined, origin);
    await screen.findByRole("heading", { name: group.name });
    expect(screen.getByRole("link", { name: "Back" })).toHaveAttribute("href", "/areas/people/participants?view=groups");
  });
  it.each(["participation", "class"] as const)("retains the shell heading when a %s group cannot load", async kind => {
    vi.mocked(getParticipationGroup).mockRejectedValue(new Error("Group details could not load."));
    vi.mocked(getNativeGroup).mockRejectedValue(new Error("Group details could not load."));
    mount(`/areas/people/groups/group${kind === "class" ? "?kind=class" : ""}`);
    expect(await screen.findByRole("alert")).toHaveTextContent("Group details could not load.");
    expect(screen.getByRole("heading", { name: "Group", level: 1 })).toBeVisible();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Try again" })).toBeVisible();
  });
  it("browses native classes, organization units and reusable groups together without rendering every roster", async () => {
    vi.mocked(listCampusGroups).mockResolvedValue({ page: 1, page_size: 25, total: 3, results: [
      { id: "class", source_id: "class", kind: "class", name: "Class 7A", member_count: 35, parent: null, href: "/areas/people/groups/class?kind=class" },
      { id: "department", source_id: "department", kind: "organization", name: "Science department", member_count: 8, parent: null, href: "/areas/people/groups/department?kind=organization" },
      { id: "group", source_id: "group", kind: "participation", name: group.name, member_count: 2, parent: null, href: "/areas/people/groups/group" },
    ] });
    mount("/areas/people/participants?view=groups");
    expect(await screen.findByRole("link", { name: "Class 7A" })).toHaveAttribute("href", "/areas/people/groups/class?kind=class");
    expect(screen.getByText("Academic class · 35 members")).toBeVisible();
    expect(screen.getByText("Organizational unit · 8 members")).toBeVisible();
    expect(screen.queryByText("Visible Member")).not.toBeInTheDocument();
  });
  it.each(["participation", "class", "organization"] as const)("retains group directory search and page after opening a %s detail", async kind => {
    vi.mocked(listCampusGroups).mockResolvedValue({ page: 2, page_size: 25, total: 26, results: [
      { id: "group", source_id: "group", kind, name: "Campus workshop", member_count: 2, parent: null, href: `/areas/people/groups/group${kind === "participation" ? "" : `?kind=${kind}`}` },
    ] });
    vi.mocked(getParticipationGroup).mockResolvedValue(group);
    if (kind !== "participation") vi.mocked(getNativeGroup).mockResolvedValue({ id: "group", kind, name: "Campus workshop", members: [], member_count: 2, page: 1, page_size: 25, total: 2, source_href: null });
    const directory = "/areas/people/participants?view=groups&search=Campus&page=2";
    mount(directory);
    await userEvent.click(await screen.findByRole("link", { name: "Campus workshop" }));
    await screen.findByRole("heading", { name: "Campus workshop" });
    expect(screen.getByRole("link", { name: "Back" })).toHaveAttribute("href", directory);
    await userEvent.click(screen.getByRole("link", { name: "Back" }));
    expect(await screen.findByRole("link", { name: "Campus workshop" })).toBeVisible();
    expect(screen.getByRole("searchbox", { name: "Search groups" })).toHaveValue("Campus");
    expect(screen.getByText("Page 2 of 2")).toBeVisible();
    expect(listCampusGroups).toHaveBeenCalledWith("campus", "Campus", 2);
  });
  it("uses the compact complete membership baseline, not the visible member page, when editing", async () => {
    vi.mocked(getParticipationGroup).mockResolvedValue(group);
    vi.mocked(listParticipants).mockResolvedValue({ page: 1, page_size: 25, total: 1, results: [{ id: "visible", label: "Visible Member", affiliations: [], has_account: false }] });
    vi.mocked(replaceParticipationGroupMembers).mockResolvedValue({ id: "group", revision: 6 });
    mount("/areas/people/groups/group");
    await userEvent.click(await screen.findByRole("button", { name: "Edit members" }));
    const dialog = within(screen.getByRole("dialog", { name: "Edit group members" }));
    expect(dialog.getByRole("status")).toHaveTextContent("2 selected across all pages");
    fireEvent.input(dialog.getByLabelText("Change from"), { target: { value: "2026-10-21" } });
    await userEvent.click(dialog.getByRole("button", { name: "Save dated membership" }));
    await waitFor(() => expect(replaceParticipationGroupMembers).toHaveBeenCalledOnce());
    expect(vi.mocked(replaceParticipationGroupMembers).mock.calls[0]![2].person_ids).toEqual(["visible", "not-on-this-page"]);
  });
  it("keeps native academic membership read-only and points to canonical people rather than a second group editor", async () => {
    vi.mocked(getNativeGroup).mockResolvedValue({ id: "class", kind: "class", name: "Class 7A", members: [{ person_id: "learner-person", label: "Aarav Sharma" }], member_count: 1, page: 1, page_size: 25, total: 1, source_href: null });
    mount("/areas/people/groups/class?kind=class");
    expect(await screen.findByRole("heading", { name: "Class 7A" })).toBeVisible();
    expect(getNativeGroup).toHaveBeenCalledWith("campus", "class", "class", 1);
    expect(screen.getByRole("link", { name: "Aarav Sharma" })).toHaveAttribute("href", "/areas/people/participants/learner-person");
    expect(screen.queryByRole("button", { name: /Edit members|Change structure/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Membership comes from academic enrollment/)).toBeVisible();
  });
  it("preserves a structure draft after cycle rejection and never treats containment as membership or permission", async () => {
    vi.mocked(getParticipationGroup).mockResolvedValue(group);
    vi.mocked(listParticipationGroups).mockResolvedValue({ page: 1, page_size: 25, total: 1, results: [{ id: "parent", name: "Parent group", revision: 1, members: [] }] });
    vi.mocked(setParticipationGroupParent).mockRejectedValue(new Error("Group containment cannot form a cycle."));
    mount("/areas/people/groups/group"); await userEvent.click(await screen.findByRole("button", { name: "Change structure" }));
    const dialog = within(screen.getByRole("dialog", { name: "Change group structure" }));
    await userEvent.click(await dialog.findByRole("radio", { name: "Parent group" }));
    fireEvent.input(dialog.getByLabelText("Effective from"), { target: { value: "2026-10-21" } });
    await userEvent.type(dialog.getByLabelText("Reason"), "Descriptive grouping");
    await userEvent.click(dialog.getByRole("button", { name: "Save group structure" }));
    expect(await dialog.findByRole("alert")).toHaveTextContent("cycle");
    expect(dialog.getByRole("radio", { name: "Parent group" })).toBeChecked();
    await userEvent.click(dialog.getByRole("button", { name: "Save group structure" }));
    expect(vi.mocked(setParticipationGroupParent).mock.calls[0]).toEqual(vi.mocked(setParticipationGroupParent).mock.calls[1]);
    expect(replaceParticipationGroupMembers).not.toHaveBeenCalled();
    expect(dialog.getByText(/app permissions, reporting lines and published rosters stay unchanged/)).toBeVisible();
  });
  it("loads membership history only when requested and pages it independently", async () => {
    vi.mocked(getParticipationGroup).mockResolvedValue(group);
    vi.mocked(getParticipationGroupHistory).mockImplementation((_school, _id, page = 1) => Promise.resolve({ page, page_size: 25, total: 26, results: [{ id: `period-${page}`, person_id: `person-${page}`, label: `Historical member ${page}`, starts_on: "2026-10-01", ends_on: "2026-10-19", revision: 1, recorded_at: "2026-10-01T12:00:00Z" }] }));
    mount("/areas/people/groups/group"); await screen.findByRole("heading", { name: group.name });
    expect(getParticipationGroupHistory).not.toHaveBeenCalled();
    await userEvent.click(screen.getByText("Membership history"));
    expect(await screen.findByText("Historical member 1")).toBeVisible();
    await userEvent.click(within(screen.getByRole("navigation", { name: "Membership history pages" })).getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Historical member 2")).toBeVisible();
    expect(screen.queryByText("Historical member 1")).not.toBeInTheDocument();
  });
  it("resets reusable group pages and editors when the group ID changes", async () => {
    vi.mocked(getParticipationGroup).mockImplementation((_school, id, page = 1) => Promise.resolve({ ...group, id, name: id === "group" ? "Campus workshop" : "Other team", page, total: 26, member_count: 26 }));
    vi.mocked(listParticipants).mockResolvedValue({ page: 1, page_size: 25, total: 1, results: [{ id: "visible", label: "Visible Member", affiliations: [], has_account: false }] });
    mount("/areas/people/groups/group", "/areas/people/groups/other");
    await screen.findByRole("heading", { name: "Campus workshop" });
    await userEvent.click(within(screen.getByRole("navigation", { name: "Group member pages" })).getByRole("button", { name: "Next" }));
    await waitFor(() => expect(getParticipationGroup).toHaveBeenCalledWith("campus", "group", 2));
    await userEvent.click(screen.getByRole("button", { name: "Edit members" }));
    expect(screen.getByRole("dialog", { name: "Edit group members" })).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Navigate to another group" }));
    await screen.findByRole("heading", { name: "Other team" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(getParticipationGroup).toHaveBeenCalledWith("campus", "other", 1);
    expect(within(screen.getByRole("navigation", { name: "Group member pages" })).getByRole("button", { name: "Previous" })).toBeDisabled();
  });
  it.each([
    { destination: "/areas/people/groups/native-b?kind=class", kind: "class" as const, id: "native-b" },
    { destination: "/areas/people/groups/native-a?kind=organization", kind: "organization" as const, id: "native-a" },
  ])("resets native member pagination when navigating to $destination", async ({ destination, kind, id }) => {
    vi.mocked(getNativeGroup).mockImplementation((_school, source, sourceId, page = 1) => Promise.resolve({ id: sourceId, kind: source, name: `${source} ${sourceId}`, members: [], member_count: 26, page, page_size: 25, total: 26, source_href: null }));
    mount("/areas/people/groups/native-a?kind=class", destination);
    await screen.findByRole("heading", { name: "class native-a" });
    await userEvent.click(within(screen.getByRole("navigation", { name: "Native group member pages" })).getByRole("button", { name: "Next" }));
    await waitFor(() => expect(getNativeGroup).toHaveBeenCalledWith("campus", "class", "native-a", 2));
    await userEvent.click(screen.getByRole("button", { name: "Navigate to another group" }));
    await screen.findByRole("heading", { name: `${kind} ${id}` });
    expect(getNativeGroup).toHaveBeenCalledWith("campus", kind, id, 1);
    expect(within(screen.getByRole("navigation", { name: "Native group member pages" })).getByRole("button", { name: "Previous" })).toBeDisabled();
  });
});
