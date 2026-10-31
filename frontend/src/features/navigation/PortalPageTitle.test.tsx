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
  it("keeps the back action without repeating a domain-owned page heading", () => {
    render(<MemoryRouter initialEntries={["/areas/people/participants/person-1"]}>
      <PortalPageTitle title="Person" rootPath="/today" contentHasHeading />
      <main><h1>Alex Morgan</h1></main>
    </MemoryRouter>);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "Alex Morgan", level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Go back" })).toBeInTheDocument();
  });

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

  it("pops from a canonical Area to the observed directory without explicit provenance", async () => {
    window.history.replaceState({ idx: 1 }, "", "/areas/dining");
    rememberPortalLocation(0, "/areas");
    render(<MemoryRouter initialEntries={["/areas", "/areas/dining"]} initialIndex={1}>
      <PortalPageTitle title="Dining" rootPath="/today" backTo="/areas" />
      <LocationProbe />
    </MemoryRouter>);

    await userEvent.click(screen.getByRole("button", { name: "Go back" }));
    expect(screen.getByTestId("location")).toHaveTextContent("/areas");
  });

  it("pops from a canonical detail to the observed filtered list", async () => {
    const origin = "/areas/people/participants?search=meera&page=3";
    window.history.replaceState({ idx: 1 }, "", "/areas/people/participants/person-1");
    rememberPortalLocation(0, origin);
    render(<MemoryRouter initialEntries={[origin, "/areas/people/participants/person-1"]} initialIndex={1}>
      <PortalPageTitle title="Person" rootPath="/today" backTo="/areas/people/participants" />
      <LocationProbe />
    </MemoryRouter>);

    await userEvent.click(screen.getByRole("button", { name: "Go back" }));
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

  it("returns from an owning More policy to the exact filtered Work queue", async () => {
    const origin = "/work?work_search=campus&work_date=2026-10-26&work_page=2";
    render(<MemoryRouter initialEntries={[{
      pathname: "/more/policies",
      search: "?policy=version-1&policy_revision=4",
      state: { portalReturnTo: origin },
    }]}>
      <PortalPageTitle title="Policy details" rootPath="/today" backTo="/more/policies" />
      <LocationProbe />
    </MemoryRouter>);
    await userEvent.click(screen.getByRole("button", { name: "Go back" }));
    expect(screen.getByTestId("location")).toHaveTextContent(origin);
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
