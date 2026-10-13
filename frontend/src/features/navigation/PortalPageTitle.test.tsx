import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { PortalPageTitle } from "./PortalPageTitle";
import { rememberPortalLocation, resetRememberedPortalHistory } from "./portalHistory";

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}</output>;
}

afterEach(() => {
  cleanup();
  resetRememberedPortalHistory();
  window.history.replaceState({}, "", "/");
});

describe("PortalPageTitle return provenance", () => {
  it("keeps the current screen when a before-back guard rejects navigation", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/teacher/attendance/class-1"]}>
        <PortalPageTitle
          title="Class attendance"
          rootPath="/teacher"
          backTo="/teacher/attendance"
          beforeBack={() => false}
        />
        <LocationProbe />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: "Go back" }));
    expect(screen.getByTestId("location")).toHaveTextContent("/teacher/attendance/class-1");
  });

  it("pops to the observed origin when it exactly matches explicit provenance", async () => {
    const user = userEvent.setup();
    const origin = "/parent/requests?category=transport";
    window.history.replaceState({ idx: 1 }, "", "/parent/departure");
    rememberPortalLocation(0, origin);
    render(
      <MemoryRouter
        initialEntries={[origin, { pathname: "/parent/departure", state: { portalReturnTo: origin } }]}
        initialIndex={1}
      >
        <PortalPageTitle title="Transport" rootPath="/parent/home" backTo="/parent/more" />
        <LocationProbe />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: "Go back" }));
    expect(screen.getByTestId("location")).toHaveTextContent(origin);
  });

  it("replaces to a valid explicit origin when browser history was not observed", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={[{
        pathname: "/principal/events/event-1",
        state: { portalReturnTo: "/principal/requests?category=events" },
      }]}>
        <PortalPageTitle title="Event" rootPath="/principal" backTo="/principal/events" />
        <LocationProbe />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: "Go back" }));
    expect(screen.getByTestId("location")).toHaveTextContent("/principal/requests?category=events");
  });

  it("ignores unsafe explicit provenance and uses the canonical parent", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={[{
        pathname: "/parent/departure",
        state: { portalReturnTo: "//example.com/parent/requests" },
      }]}>
        <PortalPageTitle title="Transport" rootPath="/parent/home" backTo="/parent/more" />
        <LocationProbe />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: "Go back" }));
    expect(screen.getByTestId("location")).toHaveTextContent("/parent/more");
  });
});
