import { afterEach, describe, expect, it, vi } from "vitest";
import { getWorkspaceManifest, normalizeWorkspaceManifest, WorkspaceManifestError } from "./api";

const wireManifest = {
  revision: "workspace-1",
  generated_at: "2026-10-18T08:00:00.000Z",
  context: {
    institution_id: "cis",
    institution_label: "Cambridge International School",
    environment: { kind: "live", namespace_id: "live-cis" },
  },
  today: {
    now: [],
    attention: { total: 0, overdue: 0, due_soon: 0 },
    next: [],
  },
  work: { total: 0, items: [] },
  areas: [{
    key: "gate",
    label: "In & Out",
    href: "/areas/in-out",
    capabilities: ["gate.manage"],
    scopes: [{ kind: "campus", id: "main", label: "Main campus" }],
    surfaces: [{
      key: "operate",
      label: "Operate In & Out",
      href: "/areas/in-out/operate",
      capabilities: ["gate.manage"],
      scopes: [{ kind: "campus", id: "main", label: "Main campus" }],
    }],
  }],
  more: { setup: [] },
  freshness: { state: "current", as_of: "8:00 AM", source_revision: "source-1" },
};

describe("workspace manifest API", () => {
  afterEach(() => vi.restoreAllMocks());

  it("retains the institution's authoritative calendar timezone and rejects malformed zones", () => {
    expect(normalizeWorkspaceManifest({ ...wireManifest, context: { ...wireManifest.context, time_zone: "Pacific/Auckland" } }).context.time_zone).toBe("Pacific/Auckland");
    expect(() => normalizeWorkspaceManifest({ ...wireManifest, context: { ...wireManifest.context, time_zone: "Not/AZone" } })).toThrow(WorkspaceManifestError);
    expect(normalizeWorkspaceManifest(wireManifest).context.time_zone).toBeNull();
  });

  it("requests the neutral workspace endpoint and normalizes optional collections", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(wireManifest), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    const result = await getWorkspaceManifest();
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/workspace", expect.objectContaining({ credentials: "same-origin" }));
    expect(result.more.other).toEqual([]);
    expect(result.more.groups).toEqual([]);
    expect(result.today.completed_automatically).toEqual([]);
    expect(result.areas[0]?.href).toBe("/areas/in-out");
    expect(result.areas[0]?.surfaces[0]?.href).toBe("/areas/in-out/operate");
  });

  it("retains source instants and the source-local calendar date through the HTTP decoder for every entry collection", async () => {
    const source = {
      id: "overnight-duty", title: "Residence night duty", time_label: "Thu, Dec 31, 2026, 10:00 PM",
      starts_at: "2026-12-31T22:00:00+05:30", ends_at: "2027-01-01T06:00:00+05:30", local_date: "2026-12-31",
      href: "/areas/timetable/schedule?date=2026-12-31", action_label: "Open timetable",
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      ...wireManifest,
      context: { ...wireManifest.context, time_zone: "Asia/Kolkata" },
      today: { ...wireManifest.today, now: [source], next: [{ ...source, id: "next-duty" }], completed_automatically: [{ ...source, id: "completed-duty" }] },
      work: { total: 1, items: [{ ...source, id: "review-duty", kind: "task", urgency: "normal" }] },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    const result = await getWorkspaceManifest();
    for (const entry of [result.today.now[0], result.today.next[0], result.today.completed_automatically?.[0], result.work.items[0]]) {
      expect(entry).toMatchObject({ starts_at: source.starts_at, ends_at: source.ends_at, local_date: source.local_date,
        time_label: source.time_label, href: source.href });
    }
    // Source offsets and source-local date are not rewritten from the device's
    // timezone or from the localized display label.
    expect(result.today.next[0]?.starts_at).not.toBe("2026-12-31T16:30:00.000Z");
  });

  it("accepts older entries with only a display time without inventing structured timing", () => {
    const source = { id: "legacy-duty", title: "Residence coordination", time_label: "Tuesday · 2:00 PM", href: "/areas/timetable/schedule", action_label: "Open timetable" };
    const result = normalizeWorkspaceManifest({ ...wireManifest, today: { ...wireManifest.today, next: [source] } });

    expect(result.today.next[0]).toMatchObject({ time_label: source.time_label, starts_at: null, ends_at: null, local_date: null, href: source.href });
  });

  it("treats absent or non-string optional timing as unknown and preserves unresolved source dates without fabricating instants", () => {
    const result = normalizeWorkspaceManifest({ ...wireManifest, today: { ...wireManifest.today, next: [
      { id: "malformed-timing", title: "Unresolved activity", starts_at: { instant: "2026-10-26T08:30:00Z" }, ends_at: 123, local_date: [], time_label: "Published time needs review" },
      { id: "date-only", title: "Dining time needs review", local_date: "2026-10-25", time_label: "Published hours repeat during a clock change" },
      { id: "invalid-instant", title: "Source timing unavailable", starts_at: "Not an instant", ends_at: "  ", local_date: null, time_label: "Time not confirmed" },
    ] } });

    expect(result.today.next[0]).toMatchObject({ starts_at: null, ends_at: null, local_date: null, time_label: "Published time needs review" });
    expect(result.today.next[1]).toMatchObject({ starts_at: null, ends_at: null, local_date: "2026-10-25" });
    // Optional timing stays a source string at this boundary; the agenda's
    // finite-instant guard falls back to time_label for an invalid instant.
    expect(result.today.next[2]).toMatchObject({ starts_at: "Not an instant", ends_at: null, local_date: null, time_label: "Time not confirmed" });
  });

  it("keeps server-authored More groups and their neutral destinations", () => {
    const result = normalizeWorkspaceManifest({
      ...wireManifest,
      more: {
        setup: [],
        other: [],
        groups: [{
          key: "account",
          label: "Account",
          items: [{ key: "profile", label: "Profile & appearance", href: "/more/account", icon: "settings" }],
        }],
      },
    });
    expect(result.more.groups).toEqual([expect.objectContaining({
      key: "account",
      items: [expect.objectContaining({ href: "/more/account" })],
    })]);
  });

  it("retains exact More capability and relationship context metadata", () => {
    const result = normalizeWorkspaceManifest({
      ...wireManifest,
      more: {
        setup: [],
        groups: [{
          key: "participation",
          label: "Policies & feedback",
          items: [{
            key: "feedback",
            label: "Teaching feedback",
            href: "/more/feedback",
            capabilities: ["teacher_feedback.coordinate", "teacher_feedback.respond"],
            scopes: [
              { kind: "institution", id: "cis", label: "Cambridge International School" },
              { kind: "dependent", id: "student-1", label: "Mira Sharma" },
            ],
          }],
        }],
      },
    });

    expect(result.more.groups?.[0]?.items[0]).toMatchObject({
      capabilities: ["teacher_feedback.coordinate", "teacher_feedback.respond"],
      scopes: [
        { kind: "institution", id: "cis", label: "Cambridge International School" },
        { kind: "dependent", id: "student-1", label: "Mira Sharma" },
      ],
    });
  });

  it("retains source-qualified offering scopes without converting them to campus authority", () => {
    const result = normalizeWorkspaceManifest({ ...wireManifest, areas: [{
      key: "messages", label: "Messages & assignments", href: "/areas/messages",
      capabilities: ["learning.assignments.manage"],
      scopes: [{ kind: "offering", id: "offering-1", label: "Saturday robotics" }],
      surfaces: [{ key: "assignments:offering:offering-1", label: "Assignments",
        href: "/areas/messages/assignments?scope=offering&offering_id=offering-1",
        capabilities: ["learning.assignments.manage"],
        scopes: [{ kind: "offering", id: "offering-1", label: "Saturday robotics" }] }],
    }] });
    expect(result.areas[0]?.surfaces[0]?.scopes).toEqual([
      { kind: "offering", id: "offering-1", label: "Saturday robotics" },
    ]);
  });

  it("rejects links outside ThatCampus instead of rendering an unsafe server value", () => {
    expect(() => normalizeWorkspaceManifest({
      ...wireManifest,
      areas: [{ ...wireManifest.areas[0], href: "https://example.invalid/fake" }],
    })).toThrow(WorkspaceManifestError);
  });

  it("rejects an incomplete source response instead of guessing a role-based workspace", () => {
    expect(() => normalizeWorkspaceManifest({ ...wireManifest, today: undefined })).toThrow(
      "today is missing from the workspace response",
    );
  });
});
