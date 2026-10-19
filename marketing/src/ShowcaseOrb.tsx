import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useReducedMotion } from 'motion/react';
import Orb from './Orb';
import './ShowcaseOrb.css';

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

export function ShowcaseOrb({ paused = false, dark = false }: { paused?: boolean; dark?: boolean }) {
  const systemDark = useSyncExternalStore(subscribeDark, darkSnapshot, serverSnapshot);
  const mobile = useSyncExternalStore(subscribeMobile, mobileSnapshot, serverSnapshot);
  const reduce = useReducedMotion();
  const container = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    if (!container.current) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setNear(true); observer.disconnect(); }
    }, { rootMargin: '160px' });
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  const isDark = dark || systemDark;
  return <div ref={container} className="showcase-orb" aria-hidden="true">
    {near && <Orb colors={isDark ? ['#4f7cff', '#8bc4ff', '#5145cd'] : ['#315deb', '#75adff', '#6558db']}
      backgroundColor={isDark ? '#14243a' : '#f8fafc'} size={1.05} glow={2.2}
      bleed={0.85} wobble={0.5} highlight={1.5} trail={0.8} speed={0.35}
      hoverIntensity={0} rotateOnHover={false} followCursor={false} clickPulse={false}
      intro={false} opacity={isDark ? 1 : 0.9} paused={paused || !!reduce} dpr={mobile ? 1 : 1.25} />}
  </div>;
}
