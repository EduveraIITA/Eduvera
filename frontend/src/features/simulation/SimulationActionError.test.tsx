import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../lib/api";
import { SimulationActionError } from "./SimulationActionError";

afterEach(cleanup);
describe("Simulation capacity recovery", () => {
  it.each(["worlds", "storage", "running_runs", "pinned_runs"])("takes %s pressure to the one saved-run manager", async resource => {
    const manage = vi.fn();
    render(<SimulationActionError onManage={manage} error={new ApiError("Please review saved simulations.", 429, { error: { code: "simulation_institution_capacity", resource } })} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Please review saved simulations.");
    await userEvent.click(screen.getByRole("button", { name: "Manage saved simulations" }));
    expect(manage).toHaveBeenCalledExactlyOnceWith(true);
  });
  it("does not turn an unrelated error into capacity recovery", () => {
    render(<SimulationActionError onManage={vi.fn()} error={new Error("Try again.")} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Try again."); expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
