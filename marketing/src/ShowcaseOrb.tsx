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
    {near && <Orb colors={isDark ? ['#4269e8', '#6c9cff', '#252f82'] : ['#244fd0', '#5c8ee5', '#4b4cba']}
      backgroundColor={isDark ? '#14243a' : '#f8fafc'} size={1.05} glow={1}
      bleed={0.65} wobble={0.5} highlight={0.9} trail={0.6} speed={0.35}
      hoverIntensity={0} rotateOnHover={false} followCursor={false} clickPulse={false}
      intro={false} opacity={isDark ? 0.9 : 0.65} paused={paused || !!reduce} dpr={mobile ? 1 : 1.25} />}
  </div>;
}
