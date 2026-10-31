import type { ReactNode } from "react";
import { Link } from "react-router-dom";

interface WorkspaceLinkProps {
  readonly href: string;
  readonly className?: string;
  readonly children: ReactNode;
  readonly ariaLabel?: string;
  readonly ariaCurrent?: "page";
  readonly state?: unknown;
}

export function WorkspaceLink({ href, className, children, ariaLabel, ariaCurrent, state }: WorkspaceLinkProps) {
  if (href.startsWith("#")) {
    return <a className={className} href={href} aria-label={ariaLabel} aria-current={ariaCurrent}>{children}</a>;
  }
  return <Link className={className} to={href} state={state} aria-label={ariaLabel} aria-current={ariaCurrent}>{children}</Link>;
}
