import "./powered-by.css";

export function PoweredBy({ className = "" }: { className?: string }) {
  // The app shell uses light surface tokens even when the device prefers dark.
  return <div className={`powered-by ${className}`.trim()} data-appearance="light">
    <div className="powered-by__inline">
      <span>Powered by</span>
      <img src="/assets/thatcampus-logo.png" alt="ThatCampus" width="56" height="34" />
    </div>
  </div>;
}
