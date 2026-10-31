import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Link, MemoryRouter, Route, Routes, useLocation, useNavigate, useNavigationType } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { PersonProfilePage } from "./PersonProfilePage";
import { getParticipant, listParticipants, listPersonConnections, listPersonGroups, createPersonConnection, endPersonConnection, savePersonContact, type ParticipantDetail, type PersonConnection } from "./participationApi";
import { enrollmentOptions, linkPersonGuardian } from "./api";
import { ExecutionEnvironmentProvider } from "../simulation/ExecutionEnvironmentContext";
import type { ExecutionEnvironment } from "../simulation/executionEnvironment";
import { ApiError } from "../../lib/api";

vi.mock("../auth/AuthContext", () => ({ useAuth: () => ({ user: { active_school_id: "campus" } }) }));
vi.mock("../../pages/operations/OperationsShell", () => ({ OperationsShell: ({ children, title, backTo, contentHasHeading = false }: { children: ReactNode; title: string; backTo?: string; contentHasHeading?: boolean }) => <>{backTo ? <Link to={backTo}>Back to people</Link> : null}{!contentHasHeading ? <header><h1>{title}</h1></header> : null}<main>{children}</main></> }));
vi.mock("./participationApi", async original => ({ ...await original<typeof import("./participationApi")>(), getParticipant: vi.fn(), listParticipants: vi.fn(), listPersonConnections: vi.fn(), listPersonGroups: vi.fn(), createPersonConnection: vi.fn(), endPersonConnection: vi.fn(), savePersonContact: vi.fn() }));
vi.mock("./api", async original => ({ ...await original<typeof import("./api")>(), linkPersonGuardian: vi.fn(), enrollmentOptions: vi.fn() }));
vi.mock("../staff-operations/StaffOperationsPage", () => ({ NewStaffDialog: () => <p>Owning work form</p> }));
const person: ParticipantDetail = { id: "person", label: "Aarav Sharma", first_name: "Aarav", last_name: "Sharma", revision: 3, affiliations: [], affiliation_sources: [], has_account: false, account_state: "not_linked", is_you: false,
  profile: { contact_email: "", contact_phone: "" }, source_profiles: [], capabilities: { can_correct_name: true, can_edit_profile: true, can_manage_connections: true, can_manage_groups: true, can_invite: true, can_enroll: true, can_add_work_profile: true, can_link_guardian: true } };
const selected: ParticipantDetail = { ...person, id: "other", label: "Ravi Singh", first_name: "Ravi", last_name: "Singh", revision: 7 };
beforeAll(() => { HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); }; HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); }; });
beforeEach(() => {
  vi.mocked(getParticipant).mockImplementation((_school, id) => Promise.resolve(id === "other" ? selected : person));
  vi.mocked(listPersonConnections).mockResolvedValue({ results: [], page: 1, page_size: 25, total: 0 });
  vi.mocked(listPersonGroups).mockResolvedValue({ results: [], page: 1, page_size: 25, total: 0 });
  vi.mocked(listParticipants).mockResolvedValue({ results: [{ id: selected.id, label: selected.label, affiliations: ["worker"], has_account: false }], page: 1, page_size: 25, total: 1 });
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });
function ProfileNavigation() {
  const navigate = useNavigate(), location = useLocation(), navigation = useNavigationType();
  const state: unknown = location.state;
  const returns = state && typeof state === "object" ? state : {};
  const peopleReturnTo = "peopleReturnTo" in returns && typeof returns.peopleReturnTo === "string" ? returns.peopleReturnTo : undefined;
  const portalReturnTo = "portalReturnTo" in returns && typeof returns.portalReturnTo === "string" ? returns.portalReturnTo : undefined;
  return <><button type="button" onClick={() => void navigate("/areas/people/participants/other")}>Navigate to another person</button><output aria-label="Profile location" data-navigation-type={navigation} data-people-return-to={peopleReturnTo} data-portal-return-to={portalReturnTo}>{location.pathname}{location.search}</output></>;
}
function mount(environment: ExecutionEnvironment = { mode: "live" }, path = "/areas/people/participants/person", returnTarget?: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const url = new URL(path, "https://thatcampus.invalid");
  render(<QueryClientProvider client={client}><ExecutionEnvironmentProvider environment={environment}><MemoryRouter initialEntries={[{ pathname: url.pathname, search: url.search, state: returnTarget ? { peopleReturnTo: returnTarget } : null }]}><ProfileNavigation /><Routes><Route path="/areas/people/participants/:personId" element={<PersonProfilePage />} /><Route path="/areas/people/groups/:groupId" element={<p>Owning group detail</p>} /></Routes></MemoryRouter></ExecutionEnvironmentProvider></QueryClientProvider>);
  return client;
}
async function openEditDetails() {
  await userEvent.click(await screen.findByRole("button", { name: "Edit details" }));
  await userEvent.click(within(screen.getByRole("dialog", { name: "Edit details" })).getByRole("button", { name: "Edit contact details" }));
}
async function openConnection(kind: "family" | "mentoring") {
  await screen.findByRole("heading", { name: person.label });
  await userEvent.click(screen.getByRole("button", { name: "Connections" }));
  await userEvent.click(screen.getByRole("button", { name: "Add connection" }));
  const chooser = screen.queryByRole("dialog", { name: "Add connection" });
  if (chooser) await userEvent.click(within(chooser).getByRole("button", { name: new RegExp(`^Add ${kind} connection`) }));
}
describe("canonical person profile", () => {
  it("starts with one identity and contextual actions, not account or exclusive person types", async () => {
    mount(); expect(await screen.findByRole("heading", { name: "Aarav Sharma" })).toBeVisible();
    for (const name of ["Edit details", "Enroll this person", "Add work profile", "Invite to app"]) expect(screen.getByRole("button", { name })).toBeVisible();
    expect(screen.getByText("No app account")).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Connections" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Groups" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Connections" }));
    await userEvent.click(screen.getByRole("button", { name: "Add connection" }));
    expect(screen.getByRole("button", { name: /^Add family connection/ })).toBeVisible();
    expect(screen.getByRole("button", { name: /^Add mentoring connection/ })).toBeVisible();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: /account type|student or staff/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Connection pages" })).not.toBeInTheDocument();
  });
  it("labels contact facts separately from the identity without adding duplicate page titles", async () => {
    vi.mocked(getParticipant).mockResolvedValue({ ...person, profile: { contact_email: "aarav@example.test", contact_phone: "+919000000001" } });
    mount();
    await screen.findByRole("heading", { name: person.label });
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    const contact = screen.getByRole("heading", { name: "Contact details" }).closest("section");
    expect(contact).not.toBeNull();
    expect(within(contact!).getByText("Email").tagName).toBe("DT");
    expect(within(contact!).getByText("aarav@example.test").tagName).toBe("DD");
    expect(within(contact!).getByText("Phone").tagName).toBe("DT");
    expect(within(contact!).getByText("+919000000001").tagName).toBe("DD");
    const identity = screen.getByRole("heading", { name: person.label }).closest("header");
    expect(identity?.querySelector(".people-avatar")).toHaveAttribute("aria-hidden", "true");
    expect(identity?.querySelector(".people-avatar")).toHaveTextContent("AS");
  });
  it("retains the shell page heading when the person cannot be loaded", async () => {
    vi.mocked(getParticipant).mockRejectedValue(new Error("Person details could not load."));
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent("Person details could not load.");
    expect(screen.getByRole("heading", { name: "Person", level: 1 })).toBeVisible();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Try again" })).toBeVisible();
  });
  it("retains native learning and work actions without offering duplicate profile creation", async () => {
    vi.mocked(getParticipant).mockResolvedValue({ ...person, source_profiles: [{ kind: "learning", id: "learner-record", label: "Class 7A", href: "/areas/people/records?student=learner-record&context=learning" }, { kind: "work", id: "staff-record", label: "Lab assistant", href: "/more/setup/responsibilities?staff=staff-record" }] });
    mount(); expect(await screen.findByRole("link", { name: /Class 7A.*Open enrollment/ })).toHaveAttribute("href", "/areas/people/records?student=learner-record&context=learning");
    expect(screen.getByRole("link", { name: /Lab assistant.*Open work/ })).toHaveAttribute("href", "/more/setup/responsibilities?staff=staff-record");
    expect(screen.queryByRole("button", { name: "Enroll this person" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add work profile" })).not.toBeInTheDocument();
  });
  it("does not infer write authority from a person being visible", async () => {
    vi.mocked(getParticipant).mockResolvedValue({ ...person, capabilities: {} });
    mount(); await screen.findByRole("heading", { name: person.label });
    expect(screen.queryByRole("button", { name: /Correct name|Edit contact|Enroll|Add work|Add family|Add mentoring|Invite/ })).not.toBeInTheDocument();
  });
  it("takes missing academic setup directly to the selected institution's terms and classes", async () => {
    vi.mocked(enrollmentOptions).mockResolvedValue({ results: [] });
    mount(); await userEvent.click(await screen.findByRole("button", { name: "Enroll this person" }));
    const dialog = within(screen.getByRole("dialog", { name: "Enroll this person" }));
    expect(await dialog.findByRole("link", { name: "Set up terms and classes" })).toHaveAttribute("href", "/more/setup/institution/academics?school=campus");
    expect(dialog.getByText(/can still join other campus activities/)).toBeVisible();
    expect(screen.queryByRole("link", { name: "Open institution setup" })).not.toBeInTheDocument();
  });
  it("resets saved notices and independent pages when following another person's profile link", async () => {
    vi.mocked(listPersonConnections).mockImplementation((_school, id, page = 1) => Promise.resolve({ page, page_size: 25, total: 26, results: [{ id: `connection-${id}`, revision: 1, type: "mentor_of", direction: "outgoing", related_person: { id: "other", label: "Ravi Singh" }, starts_on: "2026-10-01", ends_on: null, source_kind: "people", source_href: null, can_end: false }] }));
    vi.mocked(listPersonGroups).mockImplementation((_school, _id, page = 1) => Promise.resolve({ page, page_size: 25, total: 26, results: [] }));
    vi.mocked(savePersonContact).mockResolvedValue({ id: person.id, revision: 4, profile: { contact_email: "", contact_phone: "" } });
    mount(); await screen.findByRole("heading", { name: person.label });
    await userEvent.click(screen.getByRole("button", { name: "Connections" }));
    await userEvent.click(within(await screen.findByRole("navigation", { name: "Connection pages" })).getByRole("button", { name: "Next" }));
    await userEvent.click(screen.getByRole("button", { name: "Groups" }));
    await userEvent.click(within(screen.getByRole("navigation", { name: "Person group pages" })).getByRole("button", { name: "Next" }));
    await openEditDetails();
    const dialog = within(screen.getByRole("dialog", { name: "Edit contact details" }));
    await userEvent.type(dialog.getByLabelText("Reason for change"), "Contact confirmed");
    await userEvent.click(dialog.getByRole("button", { name: "Save contact details" }));
    expect(await screen.findByText("Contact details saved.")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Connections" }));
    await userEvent.click(screen.getByRole("link", { name: "Ravi Singh" }));
    await screen.findByRole("heading", { name: selected.label });
    expect(screen.queryByText("Contact details saved.")).not.toBeInTheDocument();
    expect(listPersonConnections).toHaveBeenCalledWith("campus", "other", 1);
    expect(listPersonGroups).toHaveBeenCalledWith("campus", "other", 1);
    await userEvent.click(screen.getByRole("button", { name: "Connections" }));
    expect(within(screen.getByRole("navigation", { name: "Connection pages" })).getByRole("button", { name: "Previous" })).toBeDisabled();
  });
  it("does not retain an open editor when the person route changes", async () => {
    mount(); await openEditDetails();
    await userEvent.type(screen.getByLabelText(/Contact email/), "unsaved@example.test");
    await userEvent.click(screen.getByRole("button", { name: "Navigate to another person" }));
    await screen.findByRole("heading", { name: selected.label });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(savePersonContact).not.toHaveBeenCalled();
  });
  it("shows native and reusable group memberships through their exact owning links without inventing dates", async () => {
    vi.mocked(listPersonGroups).mockResolvedValue({ results: [
      { id: "group", source_id: "group", kind: "participation", name: "Campus team", starts_on: "2026-10-01", ends_on: null, href: "/areas/people/groups/group" },
      { id: "class", source_id: "class", kind: "class", name: "Class 7A", starts_on: "2026-04-01", ends_on: "2027-03-31", href: "/areas/people/groups/class?kind=class" },
      { id: "org", source_id: "org", kind: "organization", name: "Facilities", starts_on: null, ends_on: null, href: "/areas/people/groups/org?kind=organization" },
    ], page: 1, page_size: 25, total: 3 });
    mount();
    await screen.findByRole("heading", { name: person.label });
    await userEvent.click(screen.getByRole("button", { name: "Groups" }));
    expect(await screen.findByRole("link", { name: "Class 7A" })).toHaveAttribute("href", "/areas/people/groups/class?kind=class");
    expect(screen.getByRole("link", { name: "Facilities" })).toHaveAttribute("href", "/areas/people/groups/org?kind=organization");
    expect(screen.getByText("Organization group · Current membership · dates not recorded")).toBeVisible();
    expect(screen.getByRole("link", { name: "Campus team" })).toHaveAttribute("href", "/areas/people/groups/group");
    await userEvent.click(screen.getByRole("link", { name: "Class 7A" }));
    expect(screen.getByLabelText("Profile location")).toHaveAttribute("data-people-return-to", "/areas/people/participants/person?profile_view=groups");
    expect(screen.getByLabelText("Profile location")).toHaveAttribute("data-portal-return-to", "/areas/people/participants/person?profile_view=groups");
  });
  it("offers a direct enrollment recovery path when a selected family learner is not enrolled", async () => {
    mount(); await openConnection("family");
    const dialog = within(screen.getByRole("dialog", { name: "Add family connection" }));
    await userEvent.click(await dialog.findByRole("radio", { name: /Ravi Singh/ }));
    await userEvent.click(dialog.getByRole("button", { name: "Save family connection" }));
    expect(await dialog.findByRole("alert")).toHaveTextContent("Enroll them first");
    expect(dialog.getByRole("link", { name: "Open Ravi Singh to enroll" })).toHaveAttribute("href", "/areas/people/participants/other");
    expect(linkPersonGuardian).not.toHaveBeenCalled();
  });
  it("saves a directional mentoring fact using explicit person IDs and retains its retry after error", async () => {
    vi.mocked(createPersonConnection).mockRejectedValueOnce(new Error("Connection interrupted")).mockResolvedValueOnce({ id: "connection", revision: 1 });
    mount(); await openConnection("mentoring");
    const dialog = within(screen.getByRole("dialog", { name: "Add mentoring connection" }));
    await userEvent.click(await dialog.findByRole("radio", { name: /Ravi Singh/ }));
    fireEvent.input(dialog.getByLabelText("Starts on"), { target: { value: "2026-10-20" } });
    await userEvent.type(dialog.getByLabelText("Reason"), "Approved mentoring relationship");
    await userEvent.click(dialog.getByRole("button", { name: "Save connection" }));
    expect(await dialog.findByRole("alert")).toHaveTextContent("interrupted");
    await userEvent.click(dialog.getByRole("button", { name: "Save connection" }));
    await waitFor(() => expect(createPersonConnection).toHaveBeenCalledTimes(2));
    const calls = vi.mocked(createPersonConnection).mock.calls;
    expect(calls[0]).toEqual(calls[1]);
    expect(calls[0]!.slice(0, 2)).toEqual(["campus", "person"]);
    expect(calls[0]![2]).toEqual(expect.objectContaining({ type: "mentor_of", target_person_id: "other", starts_on: "2026-10-20", ends_on: null, reason: "Approved mentoring relationship" }));
  });
  it("corrects only contact details with source revision, never credentials or membership", async () => {
    vi.mocked(savePersonContact).mockResolvedValue({ id: "person", revision: 4, profile: { contact_email: "contact@example.test", contact_phone: "" } });
    mount(); await openEditDetails();
    const dialog = within(screen.getByRole("dialog", { name: "Edit contact details" }));
    expect(dialog.getByRole("button", { name: "Cancel" })).toHaveClass("is-secondary");
    expect(dialog.getByLabelText("Reason for change").closest("form")).toHaveClass("people-editor-form");
    expect(dialog.getByLabelText(/Contact email/).closest("label")?.querySelector("span > small")).toHaveTextContent("(optional)");
    await userEvent.type(dialog.getByLabelText(/Contact email/), "contact@example.test");
    await userEvent.type(dialog.getByLabelText("Reason for change"), "Contact confirmed");
    await userEvent.click(dialog.getByRole("button", { name: "Save contact details" }));
    await waitFor(() => expect(savePersonContact).toHaveBeenCalledOnce());
    const input = vi.mocked(savePersonContact).mock.calls[0]![2];
    expect(Object.keys(input).sort()).toEqual(["contact_email", "contact_phone", "expected_revision", "idempotency_key", "reason"]);
    expect(input.expected_revision).toBe(3);
  });
  it("links the selected existing guardian to the actual learner record without granting authority", async () => {
    vi.mocked(getParticipant).mockImplementation((_school, id) => Promise.resolve(id === "other" ? selected : { ...person, source_profiles: [{ kind: "learning", id: "student-record", label: "Learner", href: "/areas/people/records?context=learning" }] }));
    vi.mocked(linkPersonGuardian).mockResolvedValue({ relationship_id: "relation" });
    mount(); await openConnection("family");
    const dialog = within(screen.getByRole("dialog", { name: "Add family connection" }));
    await userEvent.click(await dialog.findByRole("radio", { name: /Ravi Singh/ }));
    await userEvent.click(dialog.getByRole("button", { name: "Save family connection" }));
    await waitFor(() => expect(linkPersonGuardian).toHaveBeenCalledOnce());
    expect(linkPersonGuardian).toHaveBeenCalledWith(expect.objectContaining({ school_id: "campus", student_id: "student-record", person: { id: "other", expected_revision: 7 }, relationship: "guardian", is_primary: false }));
    expect(vi.mocked(linkPersonGuardian).mock.calls[0]![0]).not.toHaveProperty("can_authorize_leave");
  });
  it.each(["running", "completed"] as const)("uses the selected %s world and never offers real app access", async runStatus => {
    const client = mount({ mode: "simulation", namespaceId: "namespace", runId: "run", runStatus, virtualClock: { now: "2026-10-20T12:00:00Z", timeZone: "UTC" } });
    await screen.findByRole("heading", { name: person.label });
    expect(screen.queryByRole("button", { name: "Invite to app" })).not.toBeInTheDocument();
    expect(client.getQueryData(["execution-environment", "simulation", "namespace", "run", "people.participants", "campus", "detail", "person"])).toBeTruthy();
    if (runStatus === "completed") {
      expect(screen.getByRole("button", { name: "Edit details" })).toBeDisabled();
      await userEvent.click(screen.getByRole("button", { name: "Connections" }));
      expect(screen.getByRole("button", { name: "Add connection" })).toBeDisabled();
    }
  });
  it("reuses the owning name/contact editors from one edit entry and restores focus on close", async () => {
    mount(); const launcher = await screen.findByRole("button", { name: "Edit details" });
    const focus = launcher.focus.bind(launcher);
    const focusedWhileModalOpen: boolean[] = [];
    const focusSpy = vi.spyOn(launcher, "focus").mockImplementation(() => { focusedWhileModalOpen.push(Boolean(document.querySelector("dialog[open]"))); focus(); });
    await userEvent.click(launcher);
    focusSpy.mockClear(); focusedWhileModalOpen.length = 0;
    expect(screen.getByRole("button", { name: "Correct name" })).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Edit contact details" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Edit details" })).toHaveFocus());
    expect(focusSpy).toHaveBeenCalledOnce();
    expect(focusedWhileModalOpen).toEqual([false]);
    focusSpy.mockRestore();
  });
  it.each(["active", "inactive"] as const)("keeps the linked owner’s %s account state accurate without inviting them", async account_state => {
    vi.mocked(getParticipant).mockResolvedValue({ ...person, account_state, has_account: true, is_you: true });
    mount(); await screen.findByRole("heading", { name: person.label });
    expect(screen.getByText(account_state === "active" ? "App account · You" : "App access inactive · You")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Invite to app" })).not.toBeInTheDocument();
  });
  it("closes a contact editor when current capabilities are revoked without saving its draft", async () => {
    const client = mount(); await openEditDetails();
    await userEvent.type(screen.getByLabelText(/Contact email/), "unsaved@example.test");
    vi.mocked(getParticipant).mockResolvedValue({ ...person, capabilities: {} });
    await act(() => client.invalidateQueries({ queryKey: ["execution-environment", "live", "people.participants", "campus"] }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Edit details" })).not.toBeInTheDocument();
    expect(savePersonContact).not.toHaveBeenCalled();
  });
  it("hides all retained person/editor content on denial and stops further dependent reads", async () => {
    const client = mount(); await openEditDetails();
    vi.mocked(getParticipant).mockRejectedValue(new ApiError("Person access changed", 403));
    await act(() => client.invalidateQueries({ queryKey: ["execution-environment", "live", "people.participants", "campus"] }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Person access changed");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: person.label })).not.toBeInTheDocument();
    vi.mocked(listPersonConnections).mockClear(); vi.mocked(listPersonGroups).mockClear();
    await act(() => client.invalidateQueries({ queryKey: ["execution-environment", "live", "people.connections"] }));
    await act(() => client.invalidateQueries({ queryKey: ["execution-environment", "live", "people.person-groups"] }));
    expect(listPersonConnections).not.toHaveBeenCalled();
    expect(listPersonGroups).not.toHaveBeenCalled();
  });
  it("hides stale connections and their Add action when that section denies access", async () => {
    const client = mount(); await screen.findByRole("heading", { name: person.label });
    await userEvent.click(screen.getByRole("button", { name: "Connections" }));
    expect(screen.getByRole("button", { name: "Add connection" })).toBeVisible();
    vi.mocked(listPersonConnections).mockRejectedValue(new ApiError("Connection access changed", 403));
    await act(() => client.invalidateQueries({ queryKey: ["execution-environment", "live", "people.connections"] }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Connection access changed");
    expect(screen.queryByRole("button", { name: "Add connection" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Overview" })).toBeEnabled();
  });
  it("offers only the authorized edit/connection kind and does not add a chooser step for a single connection kind", async () => {
    vi.mocked(getParticipant).mockResolvedValue({ ...person, capabilities: { can_edit_profile: true, can_link_guardian: true } });
    mount(); await userEvent.click(await screen.findByRole("button", { name: "Edit details" }));
    expect(screen.queryByRole("button", { name: "Correct name" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit contact details" })).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    await userEvent.click(screen.getByRole("button", { name: "Connections" }));
    await userEvent.click(screen.getByRole("button", { name: "Add connection" }));
    expect(screen.getByRole("dialog", { name: "Add family connection" })).toBeVisible();
    expect(screen.queryByRole("dialog", { name: "Add connection" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Add mentoring connection/ })).not.toBeInTheDocument();
  });
  it("retains leave-signing source links and bounded history without turning a contact into authority", async () => {
    vi.mocked(listPersonConnections).mockResolvedValue({ page: 1, page_size: 25, total: 1, results: [{ id: "guardian", revision: 2, type: "guardian_of", direction: "incoming", related_person: { id: "other", label: "Ravi Singh" }, starts_on: null, ends_on: null, source_kind: "guardian", source_href: "/areas/people/records?student=student-record&context=guardian-authority", can_end: false, history: [{ revision: 1, effective_on: "2026-10-20", reason: "Contact reviewed", recorded_at: "2026-10-20T12:00:00Z" }] }] });
    mount(); await screen.findByRole("heading", { name: person.label });
    await userEvent.click(screen.getByRole("button", { name: "Connections" }));
    expect(screen.getByRole("link", { name: "Review leave-signing permission" })).toHaveAttribute("href", "/areas/people/records?student=student-record&context=guardian-authority");
    expect(screen.getByText("Contact relationship · dates not recorded")).toBeVisible();
    await userEvent.click(screen.getByText("Connection history"));
    expect(screen.getByText(/Contact reviewed/)).toBeVisible();
    expect(screen.getByText("Latest 10 recorded changes.")).toBeVisible();
    expect(screen.queryByRole("button", { name: "End connection" })).not.toBeInTheDocument();
  });
  it("keeps the reviewed ending revision and dirty draft after conflict, but closes it when current end authority is lost", async () => {
    const connection: PersonConnection = { id: "mentor", revision: 1, type: "mentor_of", direction: "outgoing", related_person: { id: "other", label: "Ravi Singh" }, starts_on: "2026-10-01", ends_on: null, source_kind: "people", source_href: null, can_end: true };
    vi.mocked(listPersonConnections).mockResolvedValue({ page: 1, page_size: 25, total: 1, results: [connection] });
    vi.mocked(endPersonConnection).mockRejectedValue(new ApiError("This connection changed. Refresh and review the current revision.", 409));
    const client = mount(); await screen.findByRole("heading", { name: person.label });
    await userEvent.click(screen.getByRole("button", { name: "Connections" }));
    await userEvent.click(screen.getByRole("button", { name: "End connection" }));
    const dialog = within(screen.getByRole("dialog", { name: "End mentoring connection" }));
    fireEvent.input(dialog.getByLabelText("Last day of connection"), { target: { value: "2026-10-21" } });
    await userEvent.type(dialog.getByLabelText("Reason"), "Reviewed end date");
    vi.mocked(listPersonConnections).mockResolvedValue({ page: 1, page_size: 25, total: 1, results: [{ ...connection, revision: 2 }] });
    await act(() => client.invalidateQueries({ queryKey: ["execution-environment", "live", "people.connections"] }));
    await userEvent.click(dialog.getByRole("button", { name: "End connection" }));
    expect(await dialog.findByRole("alert")).toHaveTextContent("Refresh and review");
    expect(endPersonConnection).toHaveBeenCalledWith("campus", "mentor", expect.objectContaining({ expected_revision: 1, ends_on: "2026-10-21", reason: "Reviewed end date" }));
    expect(dialog.getByLabelText("Reason")).toHaveValue("Reviewed end date");
    vi.mocked(listPersonConnections).mockResolvedValue({ page: 1, page_size: 25, total: 1, results: [{ ...connection, revision: 3, can_end: false }] });
    await act(() => client.invalidateQueries({ queryKey: ["execution-environment", "live", "people.connections"] }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(endPersonConnection).toHaveBeenCalledTimes(1);
  });
  it("returns from a related person to the originating Connections view and finite page", async () => {
    vi.mocked(listPersonConnections).mockImplementation((_school, id, page = 1) => Promise.resolve({ page, page_size: 25, total: 26, results: [{ id: `connection-${id}`, revision: 1, type: "mentor_of", direction: "outgoing", related_person: { id: "other", label: "Ravi Singh" }, starts_on: "2026-10-01", ends_on: null, source_kind: "people", source_href: null, can_end: false }] }));
    const origin = "/areas/people/participants/person?profile_view=connections&connection_page=2";
    mount({ mode: "live" }, origin);
    await userEvent.click(await screen.findByRole("link", { name: "Ravi Singh" }));
    await screen.findByRole("heading", { name: selected.label });
    expect(screen.getByRole("link", { name: "Back to people" })).toHaveAttribute("href", origin);
    expect(screen.getByLabelText("Profile location")).toHaveAttribute("data-portal-return-to", origin);
    await userEvent.click(screen.getByRole("button", { name: "Groups" }));
    expect(screen.getByRole("link", { name: "Back to people" })).toHaveAttribute("href", origin);
    expect(screen.getByLabelText("Profile location")).toHaveAttribute("data-portal-return-to", origin);
    expect(screen.getByLabelText("Profile location")).toHaveAttribute("data-navigation-type", "REPLACE");
    await userEvent.click(screen.getByRole("link", { name: "Back to people" }));
    await screen.findByRole("heading", { name: person.label });
    expect(screen.getByRole("button", { name: "Connections" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("Page 2 of 2")).toBeVisible();
    expect(listPersonConnections).toHaveBeenCalledWith("campus", "person", 2);
  });
  it("keeps bounded per-view pages in the URL and rejects an external profile return target", async () => {
    vi.mocked(listPersonGroups).mockImplementation((_school, _id, page = 1) => Promise.resolve({ page, page_size: 25, total: 26, results: [] }));
    mount({ mode: "live" }, "/areas/people/participants/person?profile_view=groups&connection_page=-2&group_page=2", "https://example.test/elsewhere");
    await screen.findByRole("heading", { name: person.label });
    expect(listPersonConnections).toHaveBeenCalledWith("campus", "person", 1);
    expect(listPersonGroups).toHaveBeenCalledWith("campus", "person", 2);
    expect(screen.getByRole("link", { name: "Back to people" })).toHaveAttribute("href", "/areas/people/participants");
    await userEvent.click(await screen.findByRole("button", { name: "Previous" }));
    expect(screen.getByLabelText("Profile location")).not.toHaveTextContent("group_page=2");
    expect(screen.getByLabelText("Profile location")).toHaveAttribute("data-navigation-type", "REPLACE");
    await userEvent.click(screen.getByRole("button", { name: "Overview" }));
    await userEvent.click(screen.getByRole("button", { name: "Groups" }));
    expect(screen.getByText("Page 1 of 2")).toBeVisible();
  });
  it("uses authorized successful totals as view shortcuts without claiming loading or denied counts are zero", async () => {
    vi.mocked(listPersonConnections).mockResolvedValue({ page: 1, page_size: 25, total: 26, results: [] });
    vi.mocked(listPersonGroups).mockRejectedValue(new ApiError("Groups denied", 403));
    mount(); await screen.findByRole("heading", { name: person.label });
    await userEvent.click(await screen.findByRole("button", { name: "View 26 connections" }));
    expect(screen.getByRole("button", { name: "Connections" })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByRole("button", { name: /^View .* current groups/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Active connections")).not.toBeInTheDocument();
  });
  it("fails closed for an unavailable world before starting a person query", () => {
    mount({ mode: "simulation", namespaceId: "namespace", runId: "run", unavailable: true, unavailableReason: "run_unavailable" });
    expect(screen.getByRole("alert")).toHaveTextContent("cannot be loaded from Live");
    expect(getParticipant).not.toHaveBeenCalled();
  });
});
