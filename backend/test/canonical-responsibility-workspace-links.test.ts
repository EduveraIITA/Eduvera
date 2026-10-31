import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migration = await readFile(
  new URL("../migrations/148_canonical_responsibility_workspace_links.sql", import.meta.url),
  "utf8",
);

describe("canonical responsibility workspace retained links", () => {
  it("moves every progressive starting outcome into the neutral setup guide", () => {
    expect(migration).toContain("destination='/more/setup/capabilities?task='||goal_key");
    expect(migration).toContain("'attendance','gate','timetable','examinations','performance','staff','messages'");
    expect(migration).toContain("UPDATE progressive_onboarding_workspaces workspace");
    expect(migration).toContain("canonical_responsibility_path_v148(workspace.resume_path)");
  });

  it("covers the stable shell, Areas and More destinations instead of selecting a portal", () => {
    for (const destination of [
      "/today",
      "/work",
      "/areas/attendance/registers",
      "/areas/attendance/records",
      "/areas/timetable/schedule",
      "/areas/in-out/operate",
      "/areas/messages/conversations",
      "/areas/assessments/manage",
      "/areas/responsibilities/leave",
      "/areas/people/records",
      "/areas/insights",
      "/more/setup/capabilities",
      "/more/setup/responsibilities",
      "/more/campus-view",
    ]) expect(migration).toContain(destination);
    expect(migration).toContain("defaults := 'scope=dependent'");
    expect(migration).toContain("defaults := 'scope=self'");
    expect(migration).toContain("defaults := 'scope=assigned'");
    expect(migration).toContain("defaults := 'scope=institution'");
  });

  it("retains query strings and fragments while avoiding duplicate context keys", () => {
    expect(migration).toContain("suffix := COALESCE(substring(legacy_path FROM '([?#].*)$'),'')");
    expect(migration).toContain("IF legacy_path !~ ('[?&]'||pair_key||'=')");
    expect(migration).toContain("substring(suffix FROM 2)");
    expect(migration).toContain("RETURN target||'?'||missing_defaults||suffix");
  });

  it("repairs only mutable delivery targets and leaves tenant/environment identity untouched", () => {
    expect(migration).toContain("UPDATE notifications notification");
    expect(migration).toContain("event.published_at IS NULL");
    expect(migration).toContain("'link','parent_link','student_link','staff_link','admin_link'");
    expect(migration).toContain("message.state IN ('queued','delivered','acknowledged')");
    expect(migration).toContain("'{action_path}'");
    expect(migration).not.toMatch(/SET\s+(school_id|realm_id|environment_namespace_id|recipient_agent_id)\s*=/i);
  });
});
