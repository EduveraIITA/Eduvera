import { useEffect, useRef } from "react";
import Topography from "./Topography";
import "./LoginTopography.css";

const centers: ReadonlyArray<readonly [number, number]> = [[160, 200], [920, 740], [1510, 90], [-120, 1040]];
function contour(cx: number, cy: number, radius: number, phase: number) {
  const points = Array.from({ length: 65 }, (_, i) => {
    const angle = i / 64 * Math.PI * 2;
    const r = radius * (1 + 0.12 * Math.sin(angle * 3 + phase) + 0.055 * Math.cos(angle * 5 - phase));
    return `${i ? "L" : "M"} ${(cx + Math.cos(angle) * r).toFixed(2)} ${(cy + Math.sin(angle) * r * 0.65).toFixed(2)}`;
  });
  return points.join(" ") + " Z";
}
const contours = centers.flatMap(([cx, cy], group) => Array.from({ length: 24 }, (_, index) => {
  const r = 32 + index * 27;
  return { from: contour(cx, cy, r, group), to: contour(cx, cy, r, group + 0.8), key: `${group}-${index}` };
}));

export default function LoginTopography({ dark = false }: { dark?: boolean }) {
  const fallbackRef = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => {
      if (motion.matches) fallbackRef.current?.pauseAnimations?.();
      else fallbackRef.current?.unpauseAnimations?.();
    };
    update();
    motion.addEventListener("change", update);
    return () => motion.removeEventListener("change", update);
  }, []);
  return <div className="topography-background" aria-hidden="true">
    <Topography color={dark ? "#7c9cff" : "#4f7cff"} lineCount={22} lineWidth={0.75} elevation={1} foreground={0.2}
      tilt={32} speed={0.25} direction="forward" glow={dark ? 0.65 : 0.4} depthOfField={0.3} fog={0.2}
      hoverEffect="lift" clickEffect="pulse" lightMode={!dark} opacity={dark ? 0.8 : 0.55} intro={false} dpr={1.25} />
    <svg ref={fallbackRef} className="topography-fallback" viewBox="0 0 1600 1000" preserveAspectRatio="none" focusable="false">
      <g fill="none" stroke={dark ? "#7c9cff" : "#4f7cff"} strokeWidth="0.7" opacity={dark ? 0.45 : 0.28}>
        {contours.map(({ from, to, key }) => <path key={key} d={from} vectorEffect="non-scaling-stroke">
          <animate attributeName="d" values={`${from};${to};${from}`} dur="16s" repeatCount="indefinite"
            calcMode="spline" keyTimes="0;0.5;1" keySplines="0.42 0 0.58 1;0.42 0 0.58 1" />
        </path>)}
      </g>
    </svg>
  </div>;
}
