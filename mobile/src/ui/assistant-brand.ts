/** Original ThatCampus SVG geometry. Brand colors do not signal Live/Simulation. */
export const assistantBrand = {
  feather: '#090909', featherDark: '#ffffff', dot: '#fec106',
  viewBox: '448 192 640 640', assistantDuration: 7200, loadingDuration: 2667,
  feathers: [
    'M565 410 C589 410 605 419 619 438 L685 524 C695 538 694 551 688 562 C677 579 664 583 647 574 L533 505 C507 489 501 462 515 436 C524 419 543 410 565 410 Z',
    'M768 273 C799 273 823 297 823 326 C823 335 820 352 818 365 L794 490 C790 508 782 517 768 517 C752 517 743 504 740 489 L716 365 C714 354 713 337 713 326 C713 297 737 273 768 273 Z',
    'M971 410 C947 410 931 419 917 438 L851 524 C841 538 842 551 848 562 C859 579 872 583 889 574 L1003 505 C1029 489 1035 462 1021 436 C1012 419 993 410 971 410 Z',
  ],
  loadingFeather: 'M-14-75 C-12-66 -7-62 0-62 C7-62 12-66 14-75 L29-139 C34-162 19-179 0-179 C-19-179 -34-162 -29-139 Z',
} as const;

// Original 7.2-second curiosity/blink/breathe tracks, in original path order.
export const assistantTracks = [
  { times: [0,.1,.13,.16,.2,.225,.26,.42,.48,.53,.59,.65,1], values: [0,0,3.2,-.7,1.2,0,0,0,-2.9,-2.2,.7,0,0] },
  { times: [0,.334,.35,.362,.38,.395,.713,.726,.736,.756,.767,.78,1], values: [1,1,.67,1.024,1,1,1,.76,1.01,.71,1.022,1,1] },
  { times: [0,.11,.15,.19,.23,.26,.42,.5,.54,.6,.65,1], values: [0,0,.9,-.9,0,0,0,1.2,.8,-.25,0,0] },
  { times: [0,.336,.352,.364,.382,.397,.715,.728,.738,.758,.769,.782,1], values: [1,1,.65,1.025,1,1,1,.75,1.01,.7,1.022,1,1] },
  { times: [0,.12,.17,.2,.23,.25,.26,.42,.51,.56,.61,.65,1], values: [0,0,-2.8,.6,-.8,0,0,0,3.2,2.2,-.6,0,0] },
  { times: [0,.338,.354,.366,.384,.399,.717,.73,.74,.76,.771,.784,1], values: [1,1,.67,1.024,1,1,1,.76,1.01,.71,1.022,1,1] },
  { times: [0,.06,.14,.29,.35,.49,.58,.69,.83,.93,1], values: [1,1.008,1,1.008,1,1.008,1,1.008,1,1.008,1] },
] as const;

/** Bake the SVG's .42/0/.58/1 easing once; native interpolation owns each frame. */
export function sampledAssistantTrack(track: { times: readonly number[]; values: readonly number[] }) {
  const inputRange: number[] = [], outputRange: number[] = [];
  const bezier = (t: number, a: number, b: number) => 3*(1-t)**2*t*a + 3*(1-t)*t*t*b + t**3;
  for (let segment = 0; segment < track.times.length-1; segment++) {
    for (let step = 0; step < 16; step++) {
      const x = step/16;
      let low = 0, high = 1;
      for (let attempt = 0; attempt < 20; attempt++) {
        const middle = (low+high)/2;
        if (bezier(middle,.42,.58) < x) low = middle; else high = middle;
      }
      const eased = step === 0 ? 0 : bezier((low+high)/2,0,1);
      inputRange.push(track.times[segment] + x*(track.times[segment+1]-track.times[segment]));
      outputRange.push(track.values[segment] + eased*(track.values[segment+1]-track.values[segment]));
    }
  }
  inputRange.push(1); outputRange.push(track.values.at(-1)!);
  return { inputRange, outputRange };
}

/** Original 257-frame radial scale cycle, with each successive feather offset 1/8. */
export function loadingFeatherScale(phase: number, feather: number) {
  const frame = ((phase*256 - feather*32)%256 + 256)%256;
  const y = frame <= 64 ? 1 : frame < 96 ? (1+Math.cos(Math.PI*(frame-64)/32))/2
    : frame <= 224 ? 0 : (1-Math.cos(Math.PI*(frame-224)/32))/2;
  return { x: Math.min(1,y*4), y };
}

export function brandMotionAllowed(reduced: boolean | null, focused: boolean, appState: string | null | undefined, overlayActive?: boolean) {
  return reduced === false && focused && appState === 'active' && overlayActive !== false;
}

export function brandFeatherColor(dark: boolean, onFilledAction = false) {
  return dark || onFilledAction ? assistantBrand.featherDark : assistantBrand.feather;
}
