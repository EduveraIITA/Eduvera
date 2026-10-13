import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NoticeDetailPage } from "./NoticeDetailPage";
import { getNotice, openNotice, type NoticeDetail, type NoticeRecipient } from "./api";

vi.mock("./api", async (original) => {
  const actual = await original<typeof import("./api")>();
  return { ...actual, getNotice: vi.fn(), openNotice: vi.fn().mockResolvedValue({}) };
});
vi.mock("./NoticeShell", () => ({ NoticeShell: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("./NoticeResponsePanel", () => ({ NoticeResponsePanel: () => null }));
vi.mock("./NoticeRecipientRow", () => ({ NoticeRecipientRow: () => null }));

const recipient = (seenRevision: number): NoticeRecipient => ({
  id: "recipient-1",
  recipient_role: "guardian",
  user_id: "parent-1",
  guardian_id: "guardian-1",
  student_id: "student-1",
  recipient_name: "Pooja Sharma",
  contact_phone: "",
  contact_email: "",
  opened_at: "2026-10-12T09:00:00.000Z",
  responded_at: null,
  response_value: null,
  response_note: "",
  response_channel: null,
  response_observed_at: null,
  revision: 2,
  last_seen_notice_revision: seenRevision,
  deliveries: [],
});

const detail = (seenRevision: number): NoticeDetail => ({
  id: "notice-1",
  title: "Trip timing",
  body: "The departure time changed.",
  response_mode: "information",
  response_options: [],
  priority: "normal",
  due_at: null,
  status: "cancelled",
  revision: 3,
  published_at: "2026-10-12T08:00:00.000Z",
  cancelled_at: "2026-10-13T08:00:00.000Z",
  cancellation_reason: "Trip cancelled",
  created_at: "2026-10-12T07:00:00.000Z",
  audiences: [],
  can_manage: false,
  recipient: recipient(seenRevision),
});

function show(value: NoticeDetail, client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  vi.mocked(getNotice).mockResolvedValue(value);
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/parent/notices/notice-1?student_id=student-1"]}>
        <NoticeDetailPage portal="parent" noticeId="notice-1" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...view, client };
}

function showPrincipal(value: NoticeDetail, path = "/principal/notices/notice-1?focus=attention") {
  vi.mocked(getNotice).mockResolvedValue(value);
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <NoticeDetailPage portal="principal" noticeId="notice-1" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("revision-aware notice opening", () => {
  it("records a new revision as seen even when the recipient opened an older revision", async () => {
    show(detail(2));
    await screen.findByRole("heading", { name: "Trip timing" });
    await waitFor(() => expect(vi.mocked(openNotice)).toHaveBeenCalledWith("notice-1", "student-1"));
    expect(vi.mocked(openNotice)).toHaveBeenCalledTimes(1);
  });

  it("refreshes every attention surface after the exact revision is opened", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(client, "invalidateQueries");
    show(detail(2), client);

    await screen.findByRole("heading", { name: "Trip timing" });
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["attention"] }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["notices"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["requests"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["notifications"] });
  });

  it("does not reopen a notice whose current revision is already seen", async () => {
    show(detail(3));
    await screen.findByRole("heading", { name: "Trip timing" });
    await waitFor(() => expect(getNotice).toHaveBeenCalled());
    expect(openNotice).not.toHaveBeenCalled();
  });
});

describe("notice exception attention navigation", () => {
  it("filters, highlights and focuses the recipient exceptions section", async () => {
    showPrincipal({
      ...detail(3),
      status: "published",
      can_manage: true,
      recipient: undefined,
      recipients: [{
        ...recipient(3),
        id: "recipient-failed",
        deliveries: [{ id: "delivery-1", channel: "app", status: "failed", note: "Device unavailable", provider_reference: "", attempted_at: "2026-10-13T08:00:00.000Z", created_at: "2026-10-13T08:00:00.000Z" }],
      }],
      metrics: { recipients: 1, opened: 0, responded: 0, delivery_exceptions: 1, app_accounts: 1, assisted: 0 },
    });

    const section = await screen.findByRole("region", { name: "Recipients" });
    await waitFor(() => expect(section).toHaveFocus());
    expect(section).toHaveClass("is-attention-target");
    expect(screen.getByRole("button", { name: "Needs follow-up 1" })).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps the originating list view when a draft opens in the editor", async () => {
    showPrincipal({
      ...detail(3),
      status: "draft",
      can_manage: true,
      recipient: undefined,
    }, "/principal/notices/notice-1?view=draft");

    expect(await screen.findByRole("link", { name: "Edit" })).toHaveAttribute(
      "href",
      "/principal/notices/notice-1/edit?view=draft",
    );
  });
});
