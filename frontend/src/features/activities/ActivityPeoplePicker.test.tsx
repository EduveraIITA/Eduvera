import { useState, type ComponentProps } from "react";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActivityPeoplePicker } from "./ActivityPeoplePicker";
import type { ActivityCatalogue } from "./api";
import { ExecutionEnvironmentProvider } from "../simulation/ExecutionEnvironmentContext";
import { listParticipants, type ParticipantPage } from "../people/participationApi";
vi.mock("../people/participationApi", () => ({ listParticipants: vi.fn() }));

afterEach(() => { cleanup(); vi.resetAllMocks(); });
const catalogue: ActivityCatalogue = { school_id: "campus", can_manage: true, timezone: "UTC", people: [{ id: "person", label: "Campus owner", affiliations: [] }], recorders: [], reviewers: [], groups: [], spaces: [], classes: [], subjects: [], terms: [], purposes: ["other"] };
function mount(props: Partial<ComponentProps<typeof ActivityPeoplePicker>> = {}) {
  const onPeople = vi.fn();
  const onGroups = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Harness() {
    const [people, setPeople] = useState(props.people ?? []);
    const [groups, setGroups] = useState(props.groups ?? []);
    return <ActivityPeoplePicker catalogue={catalogue} {...props} people={people} groups={groups} onPeople={(ids) => { onPeople(ids); setPeople(ids); }} onGroups={(ids) => { onGroups(ids); setGroups(ids); }} />;
  }
  render(<QueryClientProvider client={client}><ExecutionEnvironmentProvider environment={{ mode: "live" }}><Harness /></ExecutionEnvironmentProvider></QueryClientProvider>);
  return { onPeople, onGroups, client };
}
describe("shared activity participant selector", () => {
  it("preserves the generic legend and does not select the account owner implicitly", async () => {
    const { onPeople } = mount();
    expect(screen.getByRole("group", { name: "Who is expected?" })).toBeVisible();
    expect(screen.getByText(/Participants do not need app accounts/)).toBeVisible();
    const person = screen.getByRole("checkbox", { name: /Campus owner/ });
    expect(person).not.toBeChecked();
    expect(onPeople).not.toHaveBeenCalled();
    await userEvent.click(person);
    expect(onPeople).toHaveBeenCalledWith(["person"]);
    expect(person).toBeChecked();
    expect(screen.getByText("1 selected")).toBeVisible();
  });
  it("supports a purpose-specific legend without duplicating the selector or altering selection", () => {
    mount({ legend: "Whose attendance will be recorded?", hint: "Choose the people attending, not only the operator." });
    expect(screen.getByRole("group", { name: "Whose attendance will be recorded?" })).toBeVisible();
    expect(screen.getByText("Choose the people attending, not only the operator.")).toBeVisible();
    expect(screen.queryByText("Who is expected?")).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /Campus owner/ })).not.toBeChecked();
  });
  it("shows small rosters as canonical profiles immediately without inferring account or app access", async () => {
    const onCreatePerson = vi.fn();
    mount({ onCreatePerson });
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    expect(screen.queryByText("1 match")).not.toBeInTheDocument();
    expect(screen.getByText("CO")).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.queryByText(/App account|You|Administrator/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Find" })).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(screen.getByText("Campus owner"));
    expect(screen.getByRole("checkbox", { name: /Campus owner/ })).toBeChecked();
    await userEvent.click(screen.getByRole("button", { name: "Add people" }));
    expect(onCreatePerson).toHaveBeenCalledOnce();
  });
  it("keeps small-roster search discoverable, clearable and independent of selected people", async () => {
    mount();
    await userEvent.click(screen.getByRole("checkbox", { name: /Campus owner/ }));
    const find = screen.getByRole("button", { name: "Find" });
    await userEvent.click(find);
    const input = screen.getByRole("searchbox", { name: "Find people or groups" });
    expect(input).toHaveFocus();
    await userEvent.type(input, "absent name");
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getByText(/No people or groups match this search/)).toBeVisible();
    expect(screen.getByText("1 selected")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Close people search" }));
    expect(find).toHaveFocus();
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /Campus owner/ })).toBeChecked();
    await userEvent.click(find);
    await userEvent.type(screen.getByRole("searchbox"), "nothing");
    await userEvent.keyboard("{Escape}");
    expect(find).toHaveFocus();
    expect(screen.getByRole("checkbox", { name: /Campus owner/ })).toBeChecked();
  });
  it("uses keyboard-operable native checkboxes for both people and groups without selecting the operator", async () => {
    const { onPeople, onGroups } = mount({ catalogue: { ...catalogue, groups: [{ id: "team", label: "Evening team", kind: "team" }] } });
    const group = screen.getByRole("checkbox", { name: /Evening team/ });
    expect(within(group.closest("label")!).getByText("Campus group")).toBeVisible();
    expect(group.closest("label")!.querySelector('[data-product-icon="groups"]')).toHaveAttribute("aria-hidden", "true");
    group.focus();
    await userEvent.keyboard("[Space]");
    expect(group).toBeChecked();
    expect(onGroups).toHaveBeenCalledWith(["team"]);
    expect(onPeople).not.toHaveBeenCalled();
    expect(screen.getByRole("checkbox", { name: /Campus owner/ })).not.toBeChecked();
  });
  it("retains finite pages and selections across pages and full local search", async () => {
    mount({ catalogue: { ...catalogue, people: Array.from({ length: 14 }, (_, index) => ({ id: `person-${index}`, label: `Person ${String(index + 1).padStart(2, "0")}`, affiliations: [] })) } });
    expect(screen.getByRole("searchbox")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Find" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("checkbox")).toHaveLength(12);
    await userEvent.click(screen.getByRole("checkbox", { name: /Person 01/ }));
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
    expect(screen.getByText(/Page 2 of 2/)).toBeVisible();
    await userEvent.click(screen.getByRole("checkbox", { name: /Person 14/ }));
    await userEvent.type(screen.getByRole("searchbox"), "Person 01");
    expect(screen.getByRole("searchbox")).toHaveAccessibleName("Find people or groups");
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    expect(screen.getByRole("checkbox", { name: /Person 01/ })).toBeChecked();
    expect(screen.getByText("2 selected")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Clear people search" }));
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("checkbox", { name: /Person 14/ })).toBeChecked();
  });
  it("keeps the selection summary bounded instead of listing every selected name", () => {
    mount({ catalogue: { ...catalogue, people: Array.from({ length: 30 }, (_, index) => ({ id: `person-${index}`, label: `Person ${index + 1}`, affiliations: [] })) }, people: Array.from({ length: 30 }, (_, index) => `person-${index}`) });
    expect(screen.getByText("30 selected")).toHaveAttribute("aria-live", "polite");
    expect(screen.getAllByRole("checkbox")).toHaveLength(12);
    expect(screen.queryByText("Person 30")).not.toBeInTheDocument();
  });
  it("explains a truly empty campus and offers the existing create action", () => {
    mount({ catalogue: { ...catalogue, people: [] }, onCreatePerson: vi.fn() });
    expect(screen.getByText("No campus people or groups yet. Add people to get started.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Add people" })).toBeVisible();
    expect(listParticipants).not.toHaveBeenCalled();
  });
  it("shows remote loading without a false empty state or cached catalogue people", async () => {
    let complete!: (value: ParticipantPage) => void;
    vi.mocked(listParticipants).mockImplementation(() => new Promise((resolve) => { complete = resolve; }));
    mount({ catalogue: { ...catalogue, people_truncated: true } });
    expect(screen.getByRole("searchbox")).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("Finding campus people");
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByText(/No campus people|No people or groups match/)).not.toBeInTheDocument();
    await act(async () => { complete({ results: [{ id: "remote", label: "Remote person", affiliations: [], has_account: false }], total: 1, page: 1, page_size: 25 }); await Promise.resolve(); });
    expect((await screen.findByRole("checkbox", { name: /Remote person/ })).closest("label")).toBeVisible();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
  it("hides stale remote people after a failed refetch while keeping independent catalogue groups and retry", async () => {
    const data: ParticipantPage = { results: [{ id: "remote", label: "Remote person", affiliations: [], has_account: false }], total: 1, page: 1, page_size: 25 };
    vi.mocked(listParticipants).mockResolvedValueOnce(data);
    const { client, onPeople } = mount({ catalogue: { ...catalogue, people_truncated: true, groups: [{ id: "team", label: "Current campus team", kind: "team" }] } });
    expect((await screen.findByRole("checkbox", { name: /Remote person/ })).closest("label")).toBeVisible();
    vi.mocked(listParticipants).mockRejectedValueOnce(new Error("Campus people access changed."));
    await act(async () => { await client.invalidateQueries(); });
    expect(await screen.findByRole("alert")).toHaveTextContent("Campus people access changed.");
    expect(screen.queryByRole("checkbox", { name: /Remote person/ })).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /Current campus team/ }).closest("label")).toBeVisible();
    expect(screen.queryByText(/No campus people|No people or groups match/)).not.toBeInTheDocument();
    expect(onPeople).not.toHaveBeenCalled();
    vi.mocked(listParticipants).mockResolvedValueOnce(data);
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect((await screen.findByRole("checkbox", { name: /Remote person/ })).closest("label")).toBeVisible();
  });
  it("uses remote person pagination and discovery without resetting selections", async () => {
    vi.mocked(listParticipants).mockImplementation((_school, _search, page) => Promise.resolve({ results: page === 2 ? [{ id: "person-26", label: "Remote 26", affiliations: ["visitor"], has_account: false }] : Array.from({ length: 25 }, (_, index) => ({ id: `person-${index + 1}`, label: `Remote ${index + 1}`, affiliations: [], has_account: false })), page: page ?? 1, page_size: 25, total: 26 }));
    const onDiscovered = vi.fn();
    mount({ catalogue: { ...catalogue, people_truncated: true }, onDiscovered });
    await waitFor(() => expect(screen.getAllByRole("checkbox")).toHaveLength(25));
    await userEvent.click(screen.getByRole("checkbox", { name: "Remote 1 Campus person" }));
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await userEvent.click(await screen.findByRole("checkbox", { name: /Remote 26/ }));
    expect(onDiscovered).toHaveBeenLastCalledWith({ id: "person-26", label: "Remote 26", affiliations: ["visitor"] });
    expect(screen.getByText("2 selected")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(await screen.findByRole("checkbox", { name: "Remote 1 Campus person" })).toBeChecked();
  });
});
