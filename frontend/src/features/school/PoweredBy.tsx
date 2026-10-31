import "./powered-by.css";
import { BrandLogo } from "../../components/BrandLogo";

export function PoweredBy({ className = "" }: { className?: string }) {
  return <div className={`powered-by ${className}`.trim()}>
    <div className="powered-by__inline">
      <span>Powered by</span>
      <BrandLogo width={56} height={34}/>
    </div>
  </div>;
}
