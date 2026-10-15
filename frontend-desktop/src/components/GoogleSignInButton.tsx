import { useEffect, useRef, useState } from "react";

type GoogleApi = {
  initialize(options: { client_id: string; nonce: string; callback: (response: { credential: string }) => void; auto_select: boolean }): void;
  renderButton(element: HTMLElement, options: { type: string; theme: string; size: string; text: string; shape: string; width: number }): void;
};
declare global { interface Window { google?: { accounts: { id: GoogleApi } } } }
let loading: Promise<void> | undefined;
function loadGoogle() {
  if (window.google?.accounts.id) return Promise.resolve();
  if (!loading) {
    loading = new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      const timer = window.setTimeout(() => { script.remove(); reject(new Error("Google sign-in is taking too long to load.")); }, 15000);
      script.onload = () => { window.clearTimeout(timer); resolve(); };
      script.onerror = () => { window.clearTimeout(timer); script.remove(); reject(new Error("Google sign-in is unavailable right now.")); };
      document.head.appendChild(script);
    }).catch(error => { loading = undefined; throw error; });
  }
  return loading;
}

export function GoogleSignInButton({ onCredential, onError, disabled = false }: {
  onCredential: (credential: string) => Promise<void>;
  onError: (message: string) => void;
  disabled?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onCredential, onError });
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<"loading" | "ready" | "disabled" | "error">("loading");
  const [busy, setBusy] = useState(false);
  useEffect(() => { callbacks.current = { onCredential, onError }; }, [onCredential, onError]);
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    async function start() {
      try {
        const response = await fetch("/api/v1/auth/google/config/", { credentials: "same-origin", cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Google sign-in is unavailable right now.");
        const config = await response.json() as { enabled: boolean; client_id?: string; nonce?: string };
        if (cancelled) return;
        if (!config.enabled) { setState("disabled"); return; }
        if (!config.client_id || !config.nonce) throw new Error("Google sign-in is unavailable right now.");
        await loadGoogle();
        if (cancelled || !host.current || !window.google) return;
        window.google.accounts.id.initialize({
          client_id: config.client_id, nonce: config.nonce, auto_select: false,
          callback: response => {
            if (cancelled) return;
            setBusy(true);
            void callbacks.current.onCredential(response.credential).catch(error => {
              callbacks.current.onError(error instanceof Error ? error.message : "Google sign-in could not be completed.");
            }).finally(() => {
              if (!cancelled) { setBusy(false); setRetry(value => value + 1); }
            });
          },
        });
        host.current.replaceChildren();
        window.google.accounts.id.renderButton(host.current, { type: "standard", theme: "outline", size: "large", text: "continue_with", shape: "pill", width: Math.min(400, host.current.clientWidth || 300) });
        setState("ready");
      } catch {
        if (!cancelled) setState("error");
      }
    }
    void start();
    return () => { cancelled = true; controller.abort(); };
  }, [retry]);
  if (state === "disabled") return null;
  return <div style={{ display: "grid", gap: 12, marginTop: 16 }}>
    <div style={{ display: "flex", alignItems: "center", gap: 12, color: "#64748b", fontSize: 12 }}><span style={{ height: 1, background: "#e2e8f0", flex: 1 }} />or<span style={{ height: 1, background: "#e2e8f0", flex: 1 }} /></div>
    <div ref={host} aria-label="Continue with Google" inert={disabled || busy} style={{ minHeight: state === "error" ? 0 : 44, display: "flex", justifyContent: "center", opacity: disabled || busy ? 0.55 : 1 }} />
    {busy ? <span role="status" style={{ textAlign: "center", fontSize: 13 }}>Signing in with Google…</span> : null}
    {state === "loading" ? <span role="status" style={{ textAlign: "center", fontSize: 13 }}>Loading Google sign-in…</span> : null}
    {state === "error" ? <button type="button" onClick={() => { setState("loading"); setRetry(value => value + 1); }} style={{ background: "transparent", border: "1px solid #cbd5e1", borderRadius: 12, padding: 10, cursor: "pointer" }}>Retry Google sign-in</button> : null}
  </div>;
}
