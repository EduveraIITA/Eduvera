import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { GoogleSignInButton } from "./GoogleSignInButton";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); delete window.google; });
it("renders Google's button with the server nonce and submits only its credential", async () => {
  const initialize = vi.fn<NonNullable<Window["google"]>["accounts"]["id"]["initialize"]>();
  const renderButton = vi.fn();
  window.google = { accounts: { id: { initialize, renderButton } } };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ enabled: true, client_id: "public-client", nonce: "server-nonce" }) }));
  const onCredential = vi.fn().mockResolvedValue(undefined);
  render(<GoogleSignInButton onCredential={onCredential} onError={vi.fn()} />);
  await waitFor(() => expect(renderButton).toHaveBeenCalled());
  expect(initialize).toHaveBeenCalledWith(expect.objectContaining({ client_id: "public-client", nonce: "server-nonce", auto_select: false }));
  await act(async () => { initialize.mock.calls[0]![0].callback({ credential: "signed-google-token" }); await Promise.resolve(); });
  expect(onCredential).toHaveBeenCalledWith("signed-google-token");
});
it("keeps a retry available when Google configuration cannot load", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
  render(<GoogleSignInButton onCredential={vi.fn()} onError={vi.fn()} />);
  expect(await screen.findByRole("button", { name: "Retry Google sign-in" })).toBeVisible();
});
it("hides the option when the server has disabled Google sign-in", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ enabled: false }) }));
  const { container } = render(<GoogleSignInButton onCredential={vi.fn()} onError={vi.fn()} />);
  await waitFor(() => expect(container).toBeEmptyDOMElement());
});
