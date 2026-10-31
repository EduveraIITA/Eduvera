import { useRef } from "react";
import { SunMoon } from "lucide-react";
import { AppearanceControl } from "./AppearanceControl";
import "./appearance.css";

/** A small entry point before sign-in; the full preference also lives in Profile. */
export function AppearanceMenu() {
  const details=useRef<HTMLDetailsElement>(null);
  return <details className="appearance-menu" ref={details}>
    <summary aria-label="Appearance" title="Appearance"><SunMoon size={20}/></summary>
    <div className="appearance-menu__panel" onChange={()=>{
      if(details.current){details.current.open=false;details.current.querySelector('summary')?.focus();}
    }}><AppearanceControl/></div>
  </details>;
}
