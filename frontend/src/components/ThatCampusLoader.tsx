interface ThatCampusLoaderProps {
  label?: string;
}

export function ThatCampusLoader({ label = "Loading live school data…" }: ThatCampusLoaderProps) {
  return (
    <div className="route-loader" role="status" aria-live="polite" aria-busy="true">
      <img
        className="route-loader__animation"
        src="/assets/thatcampus-loader.svg"
        alt=""
        width="96"
        height="96"
        aria-hidden="true"
      />
      <span className="route-loader__still" aria-hidden="true" />
      <span className="route-loader__label">{label}</span>
    </div>
  );
}
