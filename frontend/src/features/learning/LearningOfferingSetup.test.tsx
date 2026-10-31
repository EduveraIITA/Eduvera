import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../lib/api";
import { LearningOfferingSetup } from "./LearningOfferingSetup";
import { createLearningOffering, type LearningOfferingList } from "./offeringApi";
import { getParticipant, listParticipants } from "../people/participationApi";

vi.mock("../simulation/ExecutionEnvironmentContext", () => ({ useExecutionEnvironment: () => ({ mode: "live" }) }));
vi.mock("../people/participationApi", () => ({ getParticipant: vi.fn(), listParticipants: vi.fn() }));
vi.mock("./offeringApi", () => ({ createLearningOffering: vi.fn() }));
vi.mock("../people/PeopleBulkAddDialog", () => ({ PeopleBulkAddDialog: ({ onDone }: { onDone: (people: { id: string }[]) => void }) => <button onClick={() => onDone([{ id: "learner" }])}>Import reviewed people</button> }));
const source: LearningOfferingList = { can_create: true, actor_person: { id: "instructor", name: "Meera", revision: 3 }, today: "2027-01-12", timezone: "Asia/Kolkata", items: [], page: 1, has_more: false };
const people = [{ id: "learner", label: "Sana", affiliations: ["Learner"], has_account: false }, { id: "instructor", label: "Meera", affiliations: [], has_account: true, is_you: true }];
beforeAll(() => { HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); }; HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); }; });
beforeEach(() => {
  vi.mocked(listParticipants).mockResolvedValue({ results: people, page: 1, page_size: 20, total: 2 });
  vi.mocked(getParticipant).mockImplementation((_school, id) => Promise.resolve({ id, label: id === "learner" ? "Sana" : "Meera", first_name: id, last_name: "", revision: id === "learner" ? 7 : 3, affiliation_sources: [] }));
  vi.mocked(createLearningOffering).mockImplementation(body => Promise.resolve({ id: body.offering_id, revision: 1, teaching_assignment_id: "teaching", enrollments: [{ id: "registration", person_id: "learner", revision: 1 }] }));
});
afterEach(() => { cleanup(); vi.resetAllMocks(); vi.restoreAllMocks(); });
function show(refresh = vi.fn().mockResolvedValue(undefined), onCreated = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }), onClose = vi.fn();
  const view = render(<QueryClientProvider client={client}><MemoryRouter><LearningOfferingSetup schoolId="campus" source={source} refresh={refresh} onClose={onClose} onCreated={onCreated} /></MemoryRouter></QueryClientProvider>);
  return { ...view, refresh, onCreated, onClose };
}
async function ready() {
  await userEvent.type(screen.getByLabelText("Group name"), "Saturday robotics");
  await userEvent.click(screen.getByRole("button", { name: "Choose existing people" }));
  await userEvent.click(await screen.findByRole("button", { name: "Sana Learner" }));
  await userEvent.click(screen.getByRole("button", { name: "Use 1 person" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Choose learners" })).not.toBeInTheDocument());
  await userEvent.click(screen.getByRole("button", { name: /Choose an instructor/ }));
  await userEvent.click(await screen.findByRole("button", { name: "Meera You" }));
  await userEvent.click(screen.getByRole("button", { name: "Use instructor" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Choose instructor" })).not.toBeInTheDocument());
  await userEvent.click(screen.getByRole("button", { name: "Review group" }));
}
describe("learning-group first use", () => {
  it("requires an explicit instructor and roster, not a preselected founder or school term", () => {
    show(); expect(screen.getByRole("button", { name: "Review group" })).toBeDisabled();
    expect(screen.getByText("Choose an instructor")).toBeVisible();
    expect(screen.queryByLabelText(/term|class section|student number/i)).not.toBeInTheDocument();
    expect(createLearningOffering).not.toHaveBeenCalled();
  });
  it("reviews real person references and uses the server world date without school records", async () => {
    const view = show(); await ready();
    expect(screen.getByText(/will publish assignments and review this group’s work/)).toBeVisible();
    expect(screen.getByText("1 learner · From 2027-01-12")).toBeVisible();
    expect(createLearningOffering).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Create group" }));
    await waitFor(() => expect(view.onCreated).toHaveBeenCalledOnce());
    const body = vi.mocked(createLearningOffering).mock.calls[0]![0];
    expect(body).toMatchObject({ name: "Saturday robotics", starts_on: "2027-01-12", instructor: { id: "instructor", expected_revision: 3 }, participants: [{ id: "learner", expected_revision: 7 }] });
    expect(body).not.toHaveProperty("term_id"); expect(body).not.toHaveProperty("class_section_id");
  });
  it("reuses reviewed bulk-add results and checks their exact current person revisions", async () => {
    show(); await userEvent.click(screen.getByRole("button", { name: "Add people" }));
    await userEvent.click(screen.getByRole("button", { name: "Import reviewed people" }));
    expect(await screen.findByRole("button", { name: "Remove Sana" })).toBeVisible();
    expect(getParticipant).toHaveBeenCalledWith("campus", "learner");
    expect(createLearningOffering).not.toHaveBeenCalled();
  });
  it("serializes uncertain create retries with unchanged source, command and original roster", async () => {
    vi.mocked(createLearningOffering).mockRejectedValueOnce(new ApiError("Pending", 409));
    show(); await ready(); const create = screen.getByRole("button", { name: "Create group" }); fireEvent.click(create); fireEvent.click(create);
    expect(createLearningOffering).toHaveBeenCalledOnce();
    expect(await screen.findByRole("alert")).toHaveTextContent("Pending");
    expect(screen.getByRole("button", { name: "Back", exact: true })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Retry same action" }));
    await waitFor(() => expect(createLearningOffering).toHaveBeenCalledTimes(2));
    expect(vi.mocked(createLearningOffering).mock.calls[0]).toEqual(vi.mocked(createLearningOffering).mock.calls[1]);
  });
  it("refreshes an accepted group without creating it again", async () => {
    const refresh = vi.fn().mockRejectedValueOnce(new Error("Read unavailable")).mockResolvedValue(undefined), view = show(refresh);
    await ready(); await userEvent.click(screen.getByRole("button", { name: "Create group" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Saved."); expect(view.onCreated).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Refresh saved group" }));
    await waitFor(() => expect(view.onCreated).toHaveBeenCalledOnce()); expect(createLearningOffering).toHaveBeenCalledOnce();
  });
  it("ignores accepted callbacks after the owning actor/world screen unmounts", async () => {
    let resolve!: (result: Awaited<ReturnType<typeof createLearningOffering>>) => void;
    vi.mocked(createLearningOffering).mockReturnValueOnce(new Promise(accept => { resolve = accept; }));
    const view = show(); await ready(); await userEvent.click(screen.getByRole("button", { name: "Create group" }));
    view.unmount(); await act(() => { resolve({ id: "old-world-group", revision: 1, teaching_assignment_id: "teaching", enrollments: [] }); return Promise.resolve(); });
    expect(view.onCreated).not.toHaveBeenCalled(); expect(view.refresh).not.toHaveBeenCalled();
  });
  it("keeps other-source obsolete proof from unlocking an unconfirmed offering create", async () => {
    vi.mocked(createLearningOffering).mockImplementationOnce(body => Promise.reject(new ApiError("Wrong proof", 409, { error: { fields: { assignment_obsolete: { code: "assignment_revision_obsolete", confirmation: "permanently_inapplicable", receipt_state: "absent", handler: "learning.assignments", command_id: body.command_id, source_id: body.offering_id, expected_revision: 0, current_revision: 1 } } } })));
    show(); await ready(); await userEvent.click(screen.getByRole("button", { name: "Create group" }));
    expect(await screen.findByRole("button", { name: "Retry same action" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Back", exact: true })).toBeDisabled();
  });
  it("rechecks only proven obsolete person selections and requires a fresh review before a new command", async () => {
    vi.mocked(createLearningOffering).mockImplementationOnce(body => Promise.reject(new ApiError("Selection changed", 409, { error: { fields: { offering_obsolete: { code: "learning.offering_selection_obsolete", confirmation: "permanently_inapplicable", receipt_state: "absent", handler: "learning.offerings", source_id: body.offering_id, command_id: body.command_id, expected_revision: 0, current_revision: 0, person_id: "learner", selected_revision: 7, current_person_revision: 8 } } } })));
    show(); await ready(); await userEvent.click(screen.getByRole("button", { name: "Create group" }));
    expect(await screen.findByRole("button", { name: "Review current people" })).toBeVisible();
    vi.mocked(getParticipant).mockImplementation((_school, id) => Promise.resolve({ id, label: id === "learner" ? "Sana corrected" : "Meera", first_name: id, last_name: "", revision: id === "learner" ? 8 : 3, affiliation_sources: [] }));
    await userEvent.click(screen.getByRole("button", { name: "Review current people" }));
    expect(await screen.findByRole("button", { name: "Remove Sana corrected" })).toBeVisible();
    expect(createLearningOffering).toHaveBeenCalledOnce(); await userEvent.click(screen.getByRole("button", { name: "Review group" }));
    await userEvent.click(screen.getByRole("button", { name: "Create group" }));
    await waitFor(() => expect(createLearningOffering).toHaveBeenCalledTimes(2));
    const [first, second] = vi.mocked(createLearningOffering).mock.calls.map(call => call[0]);
    expect(second!.offering_id).toBe(first!.offering_id); expect(second!.command_id).not.toBe(first!.command_id); expect(second!.participants).toEqual([{ id: "learner", expected_revision: 8 }]);
  });
  it("retains chosen learners across search and page changes", async () => {
    vi.mocked(listParticipants).mockImplementation((_school, search) => Promise.resolve({ results: search ? [people[1]!] : [people[0]!], page: 1, page_size: 1, total: 2 }));
    show(); await userEvent.click(screen.getByRole("button", { name: "Choose existing people" }));
    const dialog = await screen.findByRole("dialog", { name: "Choose learners" });
    await userEvent.click(await within(dialog).findByRole("button", { name: "Sana Learner" }));
    await userEvent.type(within(dialog).getByLabelText("Find a person"), "Meera");
    await userEvent.click(await within(dialog).findByRole("button", { name: "Meera You" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Use 2 people" }));
    expect(await screen.findByRole("button", { name: "Remove Sana" })).toBeVisible(); expect(screen.getByRole("button", { name: "Remove Meera" })).toBeVisible();
  });
});
