import "./powered-by.css";

export function PoweredBy({ className = "" }: { className?: string }) {
  // Authenticated app surfaces keep the established light shell independently
  // from a device-level dark preference.
  return <div className={`powered-by ${className}`.trim()} data-appearance="light">
    <div className="powered-by__inline">
      <span>Powered by</span>
      <img src="/assets/thatcampus-logo.png" alt="ThatCampus" width="56" height="34" />
    </div>
  </div>;
}
