import { useEffect, useRef, useState } from "react";
import { ArrowRight, CircleUserRound, LogOut, ShieldCheck } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useOptionalAuth } from "./AuthContext";
import "./auth.css";

export interface AccountMenuProps {
  buttonClassName: string;
  ariaLabel: string;
  iconSize?: number;
  onOpen?: () => void;
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .filter(Boolean)
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function AccountMenu({ buttonClassName, ariaLabel, iconSize = 21, onOpen }: AccountMenuProps) {
  const auth = useOptionalAuth();
  const navigate = useNavigate();
  const anchor = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!anchor.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  if (!auth?.user) {
    return <button className={buttonClassName} type="button" aria-label={ariaLabel} onClick={onOpen}><CircleUserRound size={iconSize} /></button>;
  }

  async function signOut() {
    if (!auth) return;
    setPending(true);
    setError(null);
    try {
      await auth.logout();
      void navigate("/login", { replace: true });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Sign out could not be completed.");
      setPending(false);
    }
  }

  const displayName = auth.user.display_name || auth.user.username;
  const avatarUrl = auth.user.avatar_url || undefined;
  const avatar = avatarUrl
    ? <img className="account-menu-trigger-avatar" src={avatarUrl} alt="" />
    : <span className="account-menu-trigger-initials" aria-hidden="true">{initials(displayName)}</span>;

  return (
    <div className="account-menu-anchor" ref={anchor}>
      <button
        className={buttonClassName}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          onOpen?.();
          setOpen((current) => !current);
        }}
      >
        {avatar}
      </button>
      {open ? (
        <div className="account-menu-popover" role="menu" aria-label="Account menu">
          <div className="account-menu__identity">
            <span className="account-menu__avatar">{avatarUrl ? <img src={avatarUrl} alt="" /> : initials(displayName)}</span>
            <span>
              <b>{displayName}</b>
              <small>{auth.user.email}</small>
              <small className="account-menu__role"><ShieldCheck size={8} /> {auth.user.role}</small>
            </span>
          </div>
          {error ? <span className="account-menu__error" role="alert">{error}</span> : null}
          {auth.portals.includes("principal") ? <a className="account-menu__logout" role="menuitem" href="/staff/administration">School administration <ArrowRight size={14} /></a> : null}
          <a className="account-menu__logout" role="menuitem" href="/staff/fees">Fees and receipts <ArrowRight size={14} /></a>
          <a className="account-menu__logout" role="menuitem" href="/staff/security">School selection and account security <ArrowRight size={14} /></a>
          <button className="account-menu__logout" role="menuitem" type="button" disabled={pending} onClick={() => void signOut()}>
            <LogOut size={16} /> {pending ? "Signing out…" : "Sign out"} <ArrowRight size={14} />
          </button>
        </div>
      ) : null}
    </div>
  );
}
