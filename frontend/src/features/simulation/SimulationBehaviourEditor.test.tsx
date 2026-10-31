import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  attendanceBehaviourInput,
  DEFAULT_ATTENDANCE_BEHAVIOUR,
  DEFAULT_SIMULATION_BEHAVIOUR,
  offerResponseBehaviourInput,
  simulationBehaviourInput,
  SimulationBehaviourEditor,
  type SimulationBehaviourForm,
} from "./SimulationBehaviourEditor";

afterEach(cleanup);

function Harness() {
  const [value, setValue] = useState<SimulationBehaviourForm>(DEFAULT_SIMULATION_BEHAVIOUR);
  return <SimulationBehaviourEditor value={value} onChange={setValue} />;
}

describe("SimulationBehaviourEditor", () => {
  it("keeps every synthetic counterpart passive until an administrator explicitly enables a model", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    expect(screen.getByRole("button", { name: /Synthetic activity models/ })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("Optional · Counterparts stay passive until enabled")).toBeVisible();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Synthetic activity models/ }));
    expect(screen.getByRole("checkbox", { name: /Model routine attendance/ })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Model coverage offer responses/ })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Model invigilation offer responses/ })).not.toBeChecked();
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: /Model coverage offer responses/ }));
    expect(screen.getByText(/65% accept/i)).toBeInTheDocument();
    expect(screen.queryByRole("spinbutton", { name: /Accept/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Adjust coverage response pattern" }));
    expect(screen.getByRole("spinbutton", { name: /Accept/ })).toHaveValue(65);
    expect(screen.getByRole("button", { name: "Hide coverage response pattern" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/never claim to predict an identified person's intent/i)).toBeInTheDocument();
  });

  it("progressively discloses only the selected activity model", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: /Synthetic activity models/ }));
    await user.click(screen.getByRole("checkbox", { name: /Model routine attendance/ }));
    await user.click(screen.getByRole("checkbox", { name: /Model invigilation offer responses/ }));
    await user.click(screen.getByRole("button", { name: "Adjust attendance pattern" }));
    expect(screen.getByRole("spinbutton", { name: /Present/ })).toHaveValue(88);
    await user.click(screen.getByRole("button", { name: "Adjust invigilation response pattern" }));
    expect(screen.queryByRole("spinbutton", { name: /Present/ })).not.toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: /No response/ })).toHaveValue(10);
  });

  it("converts declared percentages to the versioned server policy", () => {
    expect(attendanceBehaviourInput({ ...DEFAULT_ATTENDANCE_BEHAVIOUR, enabled: true })).toEqual({
      enabled: true,
      present: .88,
      late: .04,
      absent: .04,
      excused: .04,
      submission_delay_minutes: 10,
    });
    const configured = simulationBehaviourInput({
      ...DEFAULT_SIMULATION_BEHAVIOUR,
      coverageOffers: { ...DEFAULT_SIMULATION_BEHAVIOUR.coverageOffers, enabled: true },
    });
    expect(configured.schema_version).toBe(2);
    expect(configured.coverage_offers).toEqual({
      enabled: true,
      accepted: .65,
      declined: .25,
      no_response: .1,
      response_delay_minutes: 15,
    });
    expect(configured.invigilation_offers.enabled).toBe(false);
  });

  it("opens configured activity models so approved assumptions are never hidden on entry", () => {
    render(<SimulationBehaviourEditor value={{
      ...DEFAULT_SIMULATION_BEHAVIOUR,
      attendance: { ...DEFAULT_SIMULATION_BEHAVIOUR.attendance, enabled: true },
    }} onChange={() => {}} />);
    expect(screen.getByRole("button", { name: /Synthetic activity models/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("1 active · Run-only assumptions")).toBeVisible();
    expect(screen.getByRole("checkbox", { name: /Model routine attendance/ })).toBeChecked();
  });

  it("rejects invalid cohort totals and response delays before a run starts", () => {
    expect(() => attendanceBehaviourInput({ ...DEFAULT_ATTENDANCE_BEHAVIOUR, present: 80 })).toThrow(/total 100%/i);
    expect(() => attendanceBehaviourInput({ ...DEFAULT_ATTENDANCE_BEHAVIOUR, submissionDelayMinutes: 121 })).toThrow(/0 to 120/i);
    expect(() => offerResponseBehaviourInput({
      ...DEFAULT_SIMULATION_BEHAVIOUR.coverageOffers,
      accepted: 80,
    }, "Coverage offer")).toThrow(/total 100%/i);
    expect(() => offerResponseBehaviourInput({
      ...DEFAULT_SIMULATION_BEHAVIOUR.coverageOffers,
      responseDelayMinutes: 10_081,
    }, "Coverage offer")).toThrow(/0 to 10080/i);
  });
});
