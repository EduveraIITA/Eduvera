import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AssessmentResultRegister } from "./AssessmentResultRegister";
import { saveAssessmentResults, uploadAssessmentEvidence, type AssessmentDetail, type AssessmentResult } from "./api";

vi.mock("./api", async original => ({
  ...await original<typeof import("./api")>(), saveAssessmentResults: vi.fn(), uploadAssessmentEvidence: vi.fn(),
}));

const result: AssessmentResult = {
  id: "result-1", student_id: "student-1", outcome: "unrecorded", marks: null, grade: "", feedback: "",
  revision: 1, first_name: "Sana", last_name: "Audit", admission_number: "QA-1", roll_number: 1,
  evidence_count: 0, evidence: null,
};
const detail: AssessmentDetail = {
  assessment: {
    id: "assessment-1", cycle_id: "cycle-1", class_section_id: "class-1", subject_id: "subject-1", term_id: "term-1",
    title: "Programming test", assessment_kind: "class_test", maximum_marks: "20", weight_percent: null,
    scheduled_at: null, duration_minutes: 30, venue: "", instructions: "", evidence_requirement: "none",
    status: "marking", revision: 3, moderation_note: "", cycle_name: "Unit tests", subject_name: "Programming",
    color: "#0037b0", icon: "book", class_name: "BCA A", examiner_user_id: "teacher-1", examiner_name: "Meera",
    moderator_user_id: "reviewer-1", moderator_name: "Anita", roster_count: 1, unrecorded_count: 1, publication_sequence: 0,
  },
  results: [result], publications: [], viewer_role: "examiner",
};
const mount = (source = detail, refresh = vi.fn().mockResolvedValue(undefined)) => render(
  <AssessmentResultRegister schoolId="school-1" detail={source} editable refresh={refresh}/>,
);
const score = () => screen.getByRole("spinbutton", { name: "Marks for Sana" });
const outcome = () => screen.getByRole("combobox", { name: "Outcome for Sana" });

beforeEach(() => {
  vi.mocked(saveAssessmentResults).mockResolvedValue(detail.assessment);
  vi.mocked(uploadAssessmentEvidence).mockReset().mockResolvedValue({ result_id: result.id, assessment_revision: 4 });
});
afterEach(() => { cleanup(); document.documentElement.removeAttribute("data-execution-environment"); document.documentElement.removeAttribute("data-theme"); });

describe("truthful marks entry", () => {
  it("gives mobile titles, identities and outcome choices their own readable width", () => {
    // Layout source guard; actual phone-sized rendering is a separate gate.
    const css = readFileSync(resolve(process.cwd(), "src/features/assessments/assessments.css"), "utf8");
    expect(css).toMatch(/\.assessment-panel > \.assessment-detail__head\s*\{[^}]*grid-template-columns:\s*48px minmax\(0, 1fr\)/);
    expect(css).toMatch(/\.assessment-panel > \.assessment-detail__head > \.assessment-status\s*\{[^}]*grid-row:\s*2/);
    expect(css).toMatch(/\.assessment-learner\s*\{[^}]*grid-template-columns:\s*34px minmax\(0, 1fr\)/);
    expect(css).toMatch(/\.assessment-mark-row > select, \.assessment-mark-row > \.assessment-derived-grade\s*\{[^}]*grid-column:\s*1 \/ -1/);
  });
  it("keeps an untouched blank unrecorded and sends no score", () => {
    mount();
    expect(score()).toHaveValue(null);
    expect(outcome()).toHaveValue("unrecorded");
    expect(screen.getByText("0 of 1 recorded")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(saveAssessmentResults).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Enter marks or choose an outcome before saving.");
    expect(score()).toHaveAttribute("aria-invalid", "true");
  });

  it("does not turn a cleared scored value into zero", () => {
    mount();
    fireEvent.change(outcome(), { target: { value: "scored" } });
    fireEvent.change(score(), { target: { value: "12" } });
    fireEvent.change(score(), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(saveAssessmentResults).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Enter marks between 0 and 20.");
  });

  it.each(["-1", "21", "Infinity", "not a number"])('rejects invalid score "%s" without a request', value => {
    mount();
    fireEvent.change(outcome(), { target: { value: "scored" } });
    fireEvent.change(score(), { target: { value } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(saveAssessmentResults).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Enter marks between 0 and 20.");
  });

  it.each(["0", "12.5", "20"])('saves an explicitly entered score "%s" with the source revisions', async value => {
    mount();
    fireEvent.change(score(), { target: { value } });
    expect(outcome()).toHaveValue("scored");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(saveAssessmentResults).toHaveBeenCalledWith("school-1", "assessment-1", 3, [
      expect.objectContaining({ result_id: "result-1", outcome: "scored", marks: Number(value), expected_revision: 1 }),
    ]));
  });

  it.each(["0.00", "16.00"])('preserves a stored score "%s" when saving feedback', async marks => {
    mount({ ...detail, results: [{ ...result, outcome: "scored", marks, revision: 7 }] });
    expect(score()).toHaveValue(Number(marks));
    fireEvent.change(screen.getByRole("textbox", { name: "Feedback for Sana" }), { target: { value: "Reviewed work" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(saveAssessmentResults).toHaveBeenCalledWith("school-1", "assessment-1", 3, [
      expect.objectContaining({ marks: Number(marks), feedback: "Reviewed work", expected_revision: 7, reason: "Reviewed result correction" }),
    ]));
  });

  it("records an explicit non-score without any marks", async () => {
    mount();
    fireEvent.change(outcome(), { target: { value: "absent" } });
    expect(score()).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(saveAssessmentResults).toHaveBeenCalledWith("school-1", "assessment-1", 3, [
      expect.objectContaining({ outcome: "absent", marks: null }),
    ]));
  });

  it("updates clean rows from the source and blocks a dirty row whose revision changed", () => {
    const view = mount();
    const saved = { ...detail, assessment: { ...detail.assessment, revision: 4 }, results: [{ ...result, outcome: "scored" as const, marks: "8.00", revision: 2 }] };
    view.rerender(<AssessmentResultRegister schoolId="school-1" detail={saved} editable refresh={vi.fn()}/>);
    expect(score()).toHaveValue(8);
    fireEvent.change(score(), { target: { value: "9" } });
    const newer = { ...saved, assessment: { ...saved.assessment, revision: 5 }, results: [{ ...saved.results[0]!, marks: "10.00", revision: 3 }] };
    view.rerender(<AssessmentResultRegister schoolId="school-1" detail={newer} editable refresh={vi.fn()}/>);
    expect(score()).toHaveValue(9);
    expect(screen.getByRole("alert")).toHaveTextContent("Your unsaved entry has not been applied.");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(saveAssessmentResults).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Use saved result" }));
    expect(score()).toHaveValue(10);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("retains an unsaved row when a different result is refreshed", () => {
    const second = { ...result, id: "result-2", first_name: "Asha" };
    const view = mount({ ...detail, results: [result, second] });
    fireEvent.change(score(), { target: { value: "9" } });
    view.rerender(<AssessmentResultRegister schoolId="school-1" detail={{ ...detail, assessment: { ...detail.assessment, revision: 4 }, results: [result, { ...second, outcome: "scored", marks: "15.00", revision: 2 }] }} editable refresh={vi.fn()}/>);
    expect(score()).toHaveValue(9);
    expect(screen.getByRole("spinbutton", { name: "Marks for Asha" })).toHaveValue(15);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps a rejected save visible without dropping the entered score", async () => {
    vi.mocked(saveAssessmentResults).mockRejectedValueOnce(new Error("This assessment changed. Refresh before saving marks."));
    mount();
    fireEvent.change(score(), { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("This assessment changed. Refresh before saving marks.");
    expect(score()).toHaveValue(7);
  });

  it("does not allow concurrent or repeated saves while a command is pending", async () => {
    let resolve!: (value: typeof detail.assessment) => void;
    vi.mocked(saveAssessmentResults).mockReturnValueOnce(new Promise(done => { resolve = done; }));
    mount({ ...detail, results: [result, { ...result, id: "result-2", first_name: "Asha" }] });
    fireEvent.change(score(), { target: { value: "0" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Save" })[0]!);
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByRole("spinbutton", { name: "Marks for Asha" })).toBeDisabled();
    expect(saveAssessmentResults).toHaveBeenCalledTimes(1);
    resolve(detail.assessment);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Saving…" })).not.toBeInTheDocument());
  });

  it.each(["light", "dark"].flatMap(theme => ["live", "simulation"].map(environment => [theme, environment])))("uses the same blank and explicit-zero validation in %s %s document context", async (theme, environment) => {
    // This is shared-component coverage, not an isolated Simulation-store proof.
    document.documentElement.setAttribute("data-execution-environment", environment);
    document.documentElement.setAttribute("data-theme", theme);
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(saveAssessmentResults).not.toHaveBeenCalled();
    fireEvent.change(score(), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(saveAssessmentResults).toHaveBeenCalledWith("school-1", "assessment-1", 3, [expect.objectContaining({ marks: 0 })]));
  });
});

describe("deliberate published result correction",()=>{
  const published:AssessmentDetail={...detail,assessment:{...detail.assessment,status:"published",publication_sequence:1},results:[{...result,outcome:"scored",marks:"16.00",revision:2}],publications:[{id:"release-1",sequence:1,reason:"First release",published_at:"2026-10-23T09:00:00Z",source_revision:2}]};
  const start=(source=published,refresh=vi.fn().mockResolvedValue(undefined),onStateChange=vi.fn())=>render(<AssessmentResultRegister schoolId="school-1" detail={source} editable={false} refresh={refresh} onStateChange={onStateChange}/>);
  const begin=()=>fireEvent.click(screen.getByRole("button",{name:"Correct results"}));
  const reason=()=>screen.getByRole("textbox",{name:"Reason for correcting Sana"});
  it("is read-only until explicitly opened and needs a real reason and a changed result",async()=>{
    start();expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();begin();
    expect(screen.getByRole("status")).toHaveTextContent("current published result stays visible");
    fireEvent.change(score(),{target:{value:"0"}});fireEvent.click(screen.getByRole("button",{name:"Save"}));
    expect(saveAssessmentResults).not.toHaveBeenCalled();expect(screen.getByRole("alert")).toHaveTextContent("Add a reason");
    fireEvent.change(reason(),{target:{value:"Verified missing component"}});fireEvent.click(screen.getByRole("button",{name:"Save"}));
    await waitFor(()=>expect(saveAssessmentResults).toHaveBeenCalledWith("school-1","assessment-1",3,[expect.objectContaining({marks:0,expected_revision:2,reason:"Verified missing component"})]));
  });
  it("does not start a new correction round merely by entering a reason",()=>{
    start();begin();fireEvent.change(reason(),{target:{value:"Checked, nothing changed"}});fireEvent.click(screen.getByRole("button",{name:"Save"}));
    expect(saveAssessmentResults).not.toHaveBeenCalled();expect(screen.getByRole("alert")).toHaveTextContent("Change a result");
  });
  it.each(["moderator","invigilator","viewer"]as const)("does not offer correction to a %s",viewer_role=>{
    start({...published,viewer_role});expect(screen.queryByRole("button",{name:"Correct results"})).not.toBeInTheDocument();
  });
  it("does not offer an appointed moderator an admin correction bypass",()=>{
    render(<AssessmentResultRegister schoolId="school-1" detail={{...published,viewer_role:"admin"}} actorId="reviewer-1" editable refresh={vi.fn()}/>);
    expect(screen.queryByRole("button",{name:"Correct results"})).not.toBeInTheDocument();expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
  });
  it("blocks a correction after its assessment revision changes even if that learner row did not",()=>{
    const view=start();begin();fireEvent.change(score(),{target:{value:"17"}});fireEvent.change(reason(),{target:{value:"Reviewed addition"}});
    view.rerender(<AssessmentResultRegister schoolId="school-1" detail={{...published,assessment:{...published.assessment,revision:4}}} editable={false} refresh={vi.fn()}/>);
    expect(score()).toHaveValue(17);expect(screen.getByRole("button",{name:"Save"})).toBeDisabled();
    fireEvent.click(screen.getByRole("button",{name:"Use saved result"}));expect(score()).toHaveValue(16);expect(reason()).toHaveValue("");
  });
  it("keeps the failed correction and reason and lets the user discard it",async()=>{
    vi.mocked(saveAssessmentResults).mockRejectedValueOnce(new Error("The source changed. Refresh and review."));
    start();begin();fireEvent.change(score(),{target:{value:"17"}});fireEvent.change(reason(),{target:{value:"Recounted total"}});fireEvent.click(screen.getByRole("button",{name:"Save"}));
    expect(await screen.findByRole("alert")).toHaveTextContent("source changed");expect(score()).toHaveValue(17);expect(reason()).toHaveValue("Recounted total");
    fireEvent.click(screen.getByRole("button",{name:"Discard changes"}));expect(score()).toHaveValue(16);expect(reason()).toHaveValue("");
  });
  it("ignores a late successful save after the editor's session has unmounted",async()=>{
    let resolve!:(value:typeof detail.assessment)=>void;vi.mocked(saveAssessmentResults).mockReturnValueOnce(new Promise(done=>{resolve=done;}));
    const refresh=vi.fn().mockResolvedValue(undefined),view=start(published,refresh);begin();fireEvent.change(score(),{target:{value:"17"}});fireEvent.change(reason(),{target:{value:"Verified total"}});fireEvent.click(screen.getByRole("button",{name:"Save"}));
    expect(screen.getByRole("button",{name:"Cancel correction"})).toBeDisabled();view.unmount();resolve(detail.assessment);
    await waitFor(()=>expect(saveAssessmentResults).toHaveBeenCalledTimes(1));expect(refresh).not.toHaveBeenCalled();
  });
  it("keeps a read-only world read-only",()=>{
    render(<AssessmentResultRegister schoolId="school-1" detail={published} editable readOnly refresh={vi.fn()}/>);
    expect(screen.queryByRole("button",{name:"Correct results"})).not.toBeInTheDocument();expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
  });
});

describe("configured grade entry", () => {
  const configured = (): AssessmentDetail => ({ ...detail, assessment: { ...detail.assessment,
    result_policy: { policy_id: "policy-1", code: "GPA", name: "Institute grading", version: 2, semantic_fingerprint: "a".repeat(64),
      configuration: { schema_version: 1, result_format: "gpa", grade_point_scale: 10, decimal_places: 2,
        aggregation: "credit_weighted", absence_treatment: "incomplete", exemption_treatment: "exclude", gpa_failure_treatment: "include",
        bands: [ { code: "F", label: "Fail", minimum_percentage: 0, maximum_percentage: 49.99, grade_points: 0, passed: false },
          { code: "B", label: "Good", minimum_percentage: 50, maximum_percentage: 79.99, grade_points: 7, passed: true },
          { code: "A", label: "Excellent", minimum_percentage: 80, maximum_percentage: 100, grade_points: 10, passed: true } ] } },
  } });
  it("previews the configured mapping and keeps the grade server-derived", async () => {
    mount(configured());
    expect(screen.queryByRole("textbox", { name: "Grade for Sana" })).not.toBeInTheDocument();
    fireEvent.change(score(), { target: { value: "16" } });
    expect(screen.getByLabelText("Configured result for Sana")).toHaveTextContent("10.00 / 10 · A");
    expect(screen.getByText(/version 2/)).toHaveTextContent("calculated from marks");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(saveAssessmentResults).toHaveBeenCalledWith("school-1", "assessment-1", 3, [expect.objectContaining({ marks: 16, grade: "" })]));
  });
  it("keeps blank, zero and absent distinct in the policy preview", () => {
    mount(configured());
    fireEvent.change(score(), { target: { value: "0" } });
    expect(screen.getByLabelText("Configured result for Sana")).toHaveTextContent("0.00 / 10 · F");
    fireEvent.change(outcome(), { target: { value: "absent" } });
    expect(screen.getByLabelText("Configured result for Sana")).toHaveTextContent("Absent");
    expect(screen.getByLabelText("Configured result for Sana")).not.toHaveTextContent("/ 10");
  });
});

describe("evidence failure recovery", () => {
  const file = new File(["fictional evidence"], "work.pdf", { type: "application/pdf" });
  const choose = () => fireEvent.change(screen.getByLabelText("Add evidence for Sana"), { target: { files: [file] } });
  it("retains entered marks after failed finalization and permits the same file again", async () => {
    vi.mocked(uploadAssessmentEvidence).mockRejectedValueOnce(new Error("The evidence file could not be finalized. Try again."));
    mount({ ...detail, assessment: { ...detail.assessment, evidence_requirement: "required" } });
    fireEvent.change(score(), { target: { value: "12" } });
    choose();
    expect(await screen.findByRole("alert")).toHaveTextContent("could not be finalized");
    expect(score()).toHaveValue(12);
    expect(screen.getByLabelText("Add evidence for Sana")).toHaveValue("");
    expect(screen.queryByText(/recorded evidence file/)).not.toBeInTheDocument();
    choose();
    await waitFor(() => expect(uploadAssessmentEvidence).toHaveBeenCalledTimes(2));
    expect(score()).toHaveValue(12);
    expect(saveAssessmentResults).not.toHaveBeenCalled();
  });

  it("distinguishes accepted evidence from a failed register refresh", async () => {
    mount(detail, vi.fn().mockRejectedValue(new Error("Readback unavailable")));
    fireEvent.change(score(), { target: { value: "12" } }); choose();
    expect(await screen.findByRole("alert")).toHaveTextContent("Evidence added. The register couldn’t be refreshed");
    expect(score()).toHaveValue(12);
    expect(uploadAssessmentEvidence).toHaveBeenCalledOnce();
  });

  it("keeps a correction draft usable across its own confirmed evidence revision", async () => {
    const source: AssessmentDetail = { ...detail, results: [{ ...result, outcome: "scored", marks: "16", revision: 2 }], publications: [{ id: "release-1", sequence: 1, reason: "Original release", published_at: "2026-10-23T09:00:00Z", source_revision: 1 }] };
    const newer: AssessmentDetail = { ...source, assessment: { ...source.assessment, revision: 4 }, results: [{ ...source.results[0]!, evidence_count: 1, evidence: [{ id: "evidence-1", original_name: "work.pdf", content_type: "application/pdf", size_bytes: 18, uploaded_at: "2026-10-27T09:00:00Z", integrity: "verified" }] }] };
    const refresh = vi.fn().mockImplementation(() => Promise.resolve().then(() => { rendered.rerender(<AssessmentResultRegister schoolId="school-1" detail={newer} editable refresh={vi.fn().mockResolvedValue(undefined)} />); }));
    const rendered = mount(source, refresh);
    fireEvent.change(score(), { target: { value: "17" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Reason for correcting Sana" }), { target: { value: "Verified total" } });
    choose();
    await waitFor(() => expect(screen.getByText("1 recorded evidence file")).toBeVisible());
    expect(score()).toHaveValue(17);
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("labels older unchecked evidence without counting it as verified or requiring reupload", () => {
    mount({ ...detail, results: [{ ...result, evidence_count: 0, evidence: [{ id: "old-evidence", original_name: "previous.pdf", content_type: "application/pdf", size_bytes: 18, uploaded_at: "2026-10-20T09:00:00Z", integrity: "legacy_unverified" }] }] });
    expect(screen.getByText("Earlier evidence will be checked before submission.")).toBeVisible();
    expect(screen.queryByText(/recorded evidence file/)).not.toBeInTheDocument();
  });
});
