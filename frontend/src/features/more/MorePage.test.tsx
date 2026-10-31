import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { ParentMoreRoute, PrincipalMoreRoute, TeacherMoreRoute } from "./MorePage";

afterEach(cleanup);

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location">{location.pathname}</span>;
}

function show(element: ReactNode, path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={path} element={element} />
        <Route path="/more" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("retired More entry points", () => {
  it.each([
    ["/parent/more", <ParentMoreRoute />],
    ["/teacher/more", <TeacherMoreRoute />],
    ["/principal/more", <PrincipalMoreRoute />],
  ])("redirects %s to the single responsibility-composed More workspace", (path, element) => {
    show(element, path);
    expect(screen.getByTestId("location")).toHaveTextContent("/more");
  });
});
