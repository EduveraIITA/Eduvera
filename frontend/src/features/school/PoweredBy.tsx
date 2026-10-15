import "./powered-by.css";

export function PoweredBy({ className = "" }: { className?: string }) {
  return <div className={`powered-by ${className}`.trim()}>
    <div className="powered-by__ribbon">
      <span>Powered by</span>
      <i aria-hidden="true" />
      <img src="/assets/thatcampus-logo.png" alt="ThatCampus" width="56" height="32" />
    </div>
  </div>;
}
