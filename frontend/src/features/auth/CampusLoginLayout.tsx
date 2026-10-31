import { useLoginTheme } from "./useLoginTheme";
import type { ReactNode } from "react";
import "./campus-login.css";
import { AppearanceMenu } from "../appearance/AppearanceMenu";
import { BrandLogo } from "../../components/BrandLogo";
import { InfoSummary } from "../../components/InfoSummary";

export function CampusLoginLayout({ children, title = "Welcome back", description = "Sign in to your campus workspace.", eyebrow, helpContext }: { children: ReactNode; title?: string; description?: string; eyebrow?: string; helpContext?: "invitation" }) {
  const dark = useLoginTheme();
  return <div className="campus-login" data-login-theme={dark ? "dark" : "light"}>
    <div className="campus-login__frame">
      <header className="campus-login__topbar">
        <a className="campus-login__brand" href="/" aria-label="ThatCampus portal">
          <BrandLogo className="campus-login__brand-logo" width={104} height={62}/>
        </a>
        <div className="campus-login__top-actions">
          <AppearanceMenu/>
          <details className="campus-login__help">
            <InfoSummary>Help</InfoSummary>
            <div><strong>Need a hand?</strong><p>Use the account connected to your campus. If you were invited, your campus administrator can help with access.</p>
              {helpContext === "invitation" ? <a href="/forgot-password" target="_blank" rel="noopener noreferrer">Reset password in a new tab</a> : <a href="/forgot-password">Reset your password</a>}
              {helpContext !== "invitation" ? <a href="/join">Use an invitation</a> : null}
            </div>
          </details>
        </div>
      </header>
      <main className="campus-login__stage">
        <div className="campus-login__center">
          <section className="campus-login__card" aria-labelledby="campus-login-title">
            <header className="campus-login__heading">
              {eyebrow ? <span>{eyebrow}</span> : null}
              <h1 id="campus-login-title">{title}</h1>
              <p>{description}</p>
            </header>
            {children}
          </section>
        </div>
      </main>
      <footer className="campus-login__footer"><span>© {new Date().getFullYear()} ThatCampus</span></footer>
    </div>
  </div>;
}
