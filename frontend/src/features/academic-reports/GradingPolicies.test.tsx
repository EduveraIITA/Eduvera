import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GradingPolicies, GradingPolicyDialog } from "./GradingPolicies";
import { activateGradingPolicy, createGradingPolicy, type GradingPolicy } from "./api";

vi.mock("./api", async (original) => ({ ...(await original<typeof import("./api")>()), createGradingPolicy: vi.fn(), activateGradingPolicy: vi.fn() }));
afterEach(cleanup);

const policy: GradingPolicy = { id: "policy-1", name: "Ten point credits", code: "CREDITS", version: 1, status: "draft", revision: 1, configuration: { schema_version: 1, result_format: "gpa", grade_point_scale: 10, decimal_places: 2, aggregation: "credit_weighted", absence_treatment: "incomplete", exemption_treatment: "exclude", gpa_failure_treatment: "include", bands: [{ code: "P", label: "Pass", minimum_percentage: 0, maximum_percentage: 100, grade_points: 8, passed: true }] } };

describe("institution grading policy configuration", () => {
  it("retains policy information without write controls in a read-only world", () => {
    render(<GradingPolicies schoolId="school-1" policies={[policy]} refresh={vi.fn()} onCreate={vi.fn()} onRevise={vi.fn()} readOnly />);
    expect(screen.getByRole("heading", { name: "Ten point credits" })).toBeVisible();
    expect(screen.getByText("Calculation and grade bands")).toBeVisible();
    expect(screen.queryByRole("button", { name: "New grading policy" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create new version" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Activate policy" })).not.toBeInTheDocument();
  });
  it("allows a four point scale to be mapped and reviewed without publishing on Continue", async () => {
    vi.mocked(createGradingPolicy).mockReset().mockResolvedValue(policy);
    const saved = vi.fn().mockResolvedValue(undefined);
    render(<GradingPolicyDialog schoolId="school-1" close={vi.fn()} saved={saved} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Policy name" }), { target: { value: "Four point credit policy" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Result format" }), { target: { value: "gpa" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Grade point scale" }), { target: { value: "4" } });
    expect(screen.getByRole("combobox", { name: "Subject weighting" })).toHaveValue("credit_weighted");
    fireEvent.change(screen.getByRole("combobox", { name: "Failed courses" }), { target: { value: "withhold" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("heading", { name: "Grade bands" })).toHaveFocus();
    [0, 1, 2, 3, 3.3, 3.7, 4].forEach((value, index) => fireEvent.change(screen.getByRole("spinbutton", { name: `Grade points ${index + 1}` }), { target: { value: String(value) } }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("heading", { name: "Review policy" })).toHaveFocus();
    expect(screen.getByText(/66 of 80 marks = 82.50% → A → 3.70 \/ 4 points/)).toBeVisible();
    expect(createGradingPolicy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Create policy" }));
    await waitFor(() => expect(saved).toHaveBeenCalledOnce());
    const [schoolId, payload] = vi.mocked(createGradingPolicy).mock.calls[0]!;
    expect(schoolId).toBe("school-1");
    expect(payload.code).toBe("FOUR-POINT-CREDIT-POLICY");
    expect(payload.configuration).toMatchObject({ result_format: "gpa", grade_point_scale: 4, aggregation: "credit_weighted", gpa_failure_treatment: "withhold" });
    expect(payload.configuration.bands.find((band) => band.code === "A")?.grade_points).toBe(3.7);
  });

  it("blocks missing percentage ranges and retains all configured values for correction", () => {
    render(<GradingPolicyDialog schoolId="school-1" close={vi.fn()} saved={vi.fn()} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Policy name" }), { target: { value: "Grade policy" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Result format" }), { target: { value: "grade" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "Minimum 2" }), { target: { value: "41" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("alert")).toHaveTextContent("no gaps or overlaps");
    expect(screen.getByRole("spinbutton", { name: "Minimum 2" })).toHaveValue(41);
    expect(screen.queryByRole("button", { name: "Create policy" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("spinbutton", { name: "Minimum 2" }), { target: { value: "40" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("heading", { name: "Review policy" })).toBeVisible();
    expect(screen.queryByRole("columnheader", { name: "Points" })).not.toBeInTheDocument();
  });

  it("keeps a policy draft after a rejected activation and allows a retry", async () => {
    vi.mocked(activateGradingPolicy).mockReset().mockRejectedValueOnce(new Error("The policy changed. Review the saved version.")).mockResolvedValueOnce({ ...policy, status: "active" });
    const refresh = vi.fn().mockResolvedValue(undefined);
    const view = render(<GradingPolicies schoolId="school-1" policies={[policy]} refresh={refresh} onCreate={vi.fn()} />);
    const page = within(view.container);
    fireEvent.click(page.getByRole("button", { name: "Activate policy" }));
    expect(await page.findByRole("alert")).toHaveTextContent("policy changed");
    expect(refresh).not.toHaveBeenCalled();
    expect(page.getByText("Draft")).toBeVisible();
    fireEvent.click(page.getByRole("button", { name: "Activate policy" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(activateGradingPolicy).toHaveBeenLastCalledWith("school-1", "policy-1", 1, expect.any(String));
  });

  it("starts a new version with the existing code and mapping without modifying its source", async () => {
    vi.mocked(createGradingPolicy).mockReset().mockResolvedValue({ ...policy, version: 2 });
    const source = structuredClone({ ...policy, status: "active" as const });
    const saved = vi.fn().mockResolvedValue(undefined);
    render(<GradingPolicyDialog schoolId="school-1" sourcePolicy={source} close={vi.fn()} saved={saved} />);
    expect(screen.getByRole("heading", { name: "New policy version" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "Policy code" })).toHaveValue("CREDITS");
    expect(screen.getByRole("textbox", { name: "Policy code" })).toHaveAttribute("readonly");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("spinbutton", { name: "Grade points 1" })).toHaveValue(8);
    fireEvent.change(screen.getByRole("spinbutton", { name: "Grade points 1" }), { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Create policy" }));
    await waitFor(() => expect(saved).toHaveBeenCalledOnce());
    const [schoolId, payload] = vi.mocked(createGradingPolicy).mock.calls[0]!;
    expect(schoolId).toBe("school-1");
    expect(payload.code).toBe("CREDITS");
    expect(payload.configuration.bands[0]?.grade_points).toBe(7);
    expect(source.configuration.bands[0]?.grade_points).toBe(8);
  });

  it("limits generated policy codes to 32 characters and preserves a manually edited code", () => {
    render(<GradingPolicyDialog schoolId="school-1" close={vi.fn()} saved={vi.fn()} />);
    const name = screen.getByRole("textbox", { name: "Policy name" });
    const code = screen.getByRole("textbox", { name: "Policy code" });
    fireEvent.change(name, { target: { value: "Institute postgraduate engineering cumulative credit policy" } });
    expect(code).toHaveValue("INSTITUTE-POSTGRADUATE-ENGINEERI");
    expect((code as HTMLInputElement).value.length).toBeLessThanOrEqual(32);
    fireEvent.change(code, { target: { value: "PG-CREDITS" } });
    fireEvent.change(name, { target: { value: "Revised institute credit policy" } });
    expect(code).toHaveValue("PG-CREDITS");
  });
});
