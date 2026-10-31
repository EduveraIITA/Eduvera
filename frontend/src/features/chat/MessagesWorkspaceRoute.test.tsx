import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceManifest } from "../workspace/types";
import { useWorkspaceManifest } from "../workspace/useWorkspaceManifest";
import { MessagesWorkspaceRoute, messageContextOptions } from "./MessagesWorkspaceRoute";

vi.mock("../../pages/operations/OperationsShell", () => ({
  OperationsShell: ({ title, children }: { title: string; children: ReactNode }) => <main><h1>{title}</h1>{children}</main>,
}));

vi.mock("../simulation/ExecutionEnvironmentContext", () => ({
  useExecutionEnvironment: () => ({ mode: "live", namespaceId: "live-cis" }),
}));

vi.mock("../workspace/useWorkspaceManifest", () => ({
  useWorkspaceManifest: vi.fn(),
}));

vi.mock("./ChatPage", () => ({
  ChatExperience: ({ context }: { context: unknown }) => <pre data-testid="chat-context">{JSON.stringify(context)}</pre>,
}));

const manifest: WorkspaceManifest = {
  revision: "messages-workspace-1",
  generated_at: "2026-10-18T12:00:00.000Z",
  context: {
    institution_id: "cis",
    institution_label: "Cambridge International School",
    environment: { kind: "live", namespace_id: "live-cis" },
  },
  today: { now: [], attention: { total: 0, overdue: 0, due_soon: 0 }, next: [] },
  work: { total: 0, items: [] },
  areas: [{
    key: "messages",
    label: "Messages",
    description: "Secure campus communication",
    href: "/areas/messages",
    icon: "messages",
    attention_count: 0,
    capabilities: ["messages.view", "messages.send", "groups.create"],
    scopes: [{ kind: "institution", id: "cis", label: "Cambridge International School" }, { kind: "dependent", id: "aarav", label: "Aarav Sharma" }],
    surfaces: [{
      key: "conversations",
      label: "Campus conversations",
      description: "Conversations connected to your current responsibilities",
      href: "/areas/messages/conversations",
      capabilities: ["messages.view", "messages.send", "groups.create"],
      scopes: [{ kind: "institution", id: "cis", label: "Cambridge International School" }],
    }, {
      key: "conversations:dependent:aarav",
      label: "Aarav's messages",
      description: "School communication about Aarav Sharma",
      href: "/areas/messages/conversations?scope=dependent&student_id=aarav",
      capabilities: ["messages.view"],
      scopes: [{ kind: "dependent", id: "aarav", label: "Aarav Sharma" }],
    }],
  }],
  more: { setup: [], other: [] },
  freshness: { state: "current", as_of: "12:00 PM", source_revision: "messages-1" },
};

function LocationSearch() {
  return <output data-testid="location-search">{useLocation().search}</output>;
}

function show(path = "/areas/messages/conversations") {
  return render(<MemoryRouter initialEntries={[path]}>
    <MessagesWorkspaceRoute />
    <LocationSearch />
  </MemoryRouter>);
}

beforeEach(() => {
  vi.mocked(useWorkspaceManifest).mockReturnValue({
    data: manifest,
    error: null,
    isPending: false,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useWorkspaceManifest>);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("responsibility-composed Messages workspace", () => {
  it("derives operational and relationship contexts from manifest surfaces", () => {
    const area = manifest.areas[0]!;
    expect(messageContextOptions(area).map((option) => option.context)).toEqual([
      expect.objectContaining({ kind: "responsibility", canCreateGroups: true }),
      expect.objectContaining({ kind: "dependent", studentId: "aarav", canCreateGroups: false }),
    ]);
  });

  it("opens the neutral operational surface without selecting a persona portal", () => {
    show();

    expect(screen.getByRole("heading", { name: "Messages" })).toBeInTheDocument();
    expect(screen.getByText("Campus conversations", { selector: "strong" })).toBeInTheDocument();
    expect(screen.getByTestId("chat-context")).toHaveTextContent('"kind":"responsibility"');
    expect(screen.getByTestId("chat-context")).toHaveTextContent('"canCreateGroups":true');
  });

  it("uses the exact relationship surface and switches scope without retaining a conversation", () => {
    show("/areas/messages/conversations?scope=dependent&student_id=aarav&conversation=thread-1&keep=date");

    expect(screen.getByTestId("chat-context")).toHaveTextContent('"kind":"dependent"');
    expect(screen.getByTestId("chat-context")).toHaveTextContent('"studentId":"aarav"');

    fireEvent.change(screen.getByRole("combobox", { name: "Choose conversation scope" }), { target: { value: "conversations" } });

    expect(screen.getByTestId("location-search")).toHaveTextContent("?keep=date");
    expect(screen.getByTestId("chat-context")).toHaveTextContent('"kind":"responsibility"');
  });

  it("repairs an old dependent bookmark when only one learner relationship is available", async () => {
    show("/areas/messages/conversations?scope=dependent&keep=date#latest");

    expect(await screen.findByTestId("chat-context")).toHaveTextContent('"studentId":"aarav"');
    expect(screen.getByTestId("location-search")).toHaveTextContent("scope=dependent&keep=date&student_id=aarav");
  });

  it("asks for the learner instead of choosing silently when a family has several relationships", () => {
    const messages = manifest.areas[0]!;
    vi.mocked(useWorkspaceManifest).mockReturnValue({
      data: {
        ...manifest,
        areas: [{
          ...messages,
          surfaces: [...messages.surfaces, {
            ...messages.surfaces[1]!,
            key: "conversations:dependent:mira",
            label: "Mira's messages",
            href: "/areas/messages/conversations?scope=dependent&student_id=mira",
            scopes: [{ kind: "dependent", id: "mira", label: "Mira Sharma" }],
          }],
        }],
      },
      error: null,
      isPending: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useWorkspaceManifest>);

    show("/areas/messages/conversations?scope=dependent&keep=date#latest");

    expect(screen.getByRole("heading", { name: "Choose a learner for messages" })).toBeVisible();
    expect(screen.getByRole("link", { name: /^Aarav Sharma/i })).toHaveAttribute(
      "href",
      "/areas/messages/conversations?scope=dependent&keep=date&student_id=aarav#latest",
    );
    expect(screen.getByRole("link", { name: /^Mira Sharma/i })).toBeVisible();
  });

  it("fails closed when a relationship URL does not match an authorized surface", () => {
    show("/areas/messages/conversations?scope=dependent&student_id=unknown");

    expect(screen.getByRole("heading", { name: "Your workspace access changed" })).toBeInTheDocument();
    expect(screen.queryByTestId("chat-context")).not.toBeInTheDocument();
  });
});
