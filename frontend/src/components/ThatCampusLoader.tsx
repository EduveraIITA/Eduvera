interface ThatCampusLoaderProps {
  label?: string;
}

export function ThatCampusLoader({ label = "Loading campus data…" }: ThatCampusLoaderProps) {
  return (
    <div className="route-loader" role="status" aria-live="polite" aria-busy="true">
      <img
        className="route-loader__animation route-loader__animation--light"
        src="/assets/thatcampus-loader-fast.svg"
        alt=""
        width="72"
        height="72"
        aria-hidden="true"
      />
      <img className="route-loader__animation route-loader__animation--dark" src="/assets/thatcampus-loader-fast-dark.svg" alt="" width="72" height="72" aria-hidden="true" />
      <span className="route-loader__still" aria-hidden="true" />
      <span className="route-loader__label">{label}</span>
    </div>
  );
}

export function ThatCampusLoadingIcon({ size = 18, className = "" }: { size?: number; className?: string }) {
  return <span className={`thatcampus-loading-icon ${className}`} style={{ width: size, height: size, display: "inline-flex", flexShrink: 0, animation: "none", border: 0, background: "transparent" }} aria-hidden="true">
    <img className="thatcampus-loading-icon__light" src="/assets/thatcampus-loader-fast.svg" alt="" width={size} height={size} />
    <img className="thatcampus-loading-icon__dark" src="/assets/thatcampus-loader-fast-dark.svg" alt="" width={size} height={size} />
    <span className="thatcampus-loading-icon__still" />
  </span>;
}
