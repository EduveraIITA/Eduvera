import { useSyncExternalStore } from 'react';
import { useReducedMotion } from 'motion/react';
import GhostFibers from './GhostFibers';
import './HeroGhostFibers.css';

const darkQuery = '(prefers-color-scheme: dark)';
const mobileQuery = '(max-width: 650px)';
function subscribe(query: string, update: () => void) {
  const media = window.matchMedia(query);
  media.addEventListener('change', update);
  return () => media.removeEventListener('change', update);
}
const subscribeDark = (update: () => void) => subscribe(darkQuery, update);
const subscribeMobile = (update: () => void) => subscribe(mobileQuery, update);
const darkSnapshot = () => window.matchMedia(darkQuery).matches;
const mobileSnapshot = () => window.matchMedia(mobileQuery).matches;
const serverSnapshot = () => false;

export function HeroGhostFibers({ paused = false }: { paused?: boolean }) {
  const dark = useSyncExternalStore(subscribeDark, darkSnapshot, serverSnapshot);
  const mobile = useSyncExternalStore(subscribeMobile, mobileSnapshot, serverSnapshot);
  const reduce = useReducedMotion();
  return <div className="hero-ghost-fibers" aria-hidden="true">
    <GhostFibers glowColor={dark ? '#6b96ff' : '#0753db'}
      lineColor={dark ? '#94b2ff' : '#3871d8'} secondaryColor={dark ? '#8a7be1' : '#6976cf'}
      lightMode={!dark} speed={0.2} scale={1.1} rotation={-15} rollSpeed={0.05}
      layers={3} threads={mobile ? 36 : 60} density={0.7} fiberStyle="lines"
      glow={0.45} brightness={0.75} particles={0.08} sparkle={0.1} grain={0.01}
      vignette={0.1} mouseInteraction={false} pulseOnClick={false} intro={false}
      paused={paused || !!reduce} dpr={mobile ? 1 : 1.25} />
  </div>;
}
