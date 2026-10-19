import type { ComponentType } from 'react';
type OrbProps = {
  colors?: string[]; backgroundColor?: string; size?: number; glow?: number;
  bleed?: number; wobble?: number; highlight?: number; trail?: number;
  speed?: number; hoverIntensity?: number; rotateOnHover?: boolean;
  followCursor?: boolean; clickPulse?: boolean; intro?: boolean;
  opacity?: number; paused?: boolean; dpr?: number;
};
declare const Orb: ComponentType<OrbProps>;
export default Orb;
