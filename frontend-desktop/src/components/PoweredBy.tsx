import "./powered-by.css";
import { useLoginTheme } from "./useLoginTheme";

export function PoweredBy({ className = "" }: { className?: string }) {
  const dark = useLoginTheme();
  return <div className={`powered-by ${className}`.trim()} data-appearance={dark ? "dark" : "light"}>
    <div className="powered-by__inline">
      <span>Powered by</span>
      <img src={dark ? "/assets/thatcampus-logo-dark.png" : "/assets/thatcampus-logo.png"} alt="ThatCampus" width="56" height="34" />
    </div>
  </div>;
}
