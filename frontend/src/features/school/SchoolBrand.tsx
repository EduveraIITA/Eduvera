import "./school-brand.css";

const eduveraMark = "/assets/eduvera-mark.png";

export function SchoolBrand({
  name,
  className = "",
  marksLayout = "overlap",
}: {
  name: string;
  className?: string;
  marksLayout?: "overlap" | "side-by-side";
}) {
  const crest = name.split(/\s+/).filter(Boolean).map((word) => word[0]).join("").slice(0, 3).toUpperCase();
  return (
    <div className={`school-brand ${className}`.trim()} aria-label={`${name} and Eduvera`}>
      <span className={`school-brand__marks school-brand__marks--${marksLayout}`} aria-hidden="true">
        <span className="school-brand__crest">{crest}</span>
        <span className="school-brand__eduvera">
          <img src={eduveraMark} alt="" />
        </span>
      </span>
      <span className="school-brand__name">{name}</span>
    </div>
  );
}
