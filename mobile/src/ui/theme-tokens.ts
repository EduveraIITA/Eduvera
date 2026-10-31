// Canonical theme for the single React Native/Expo frontend.
// Preserves the accepted Light/Dark and Live/Simulation values from the frozen web reference.

export interface ThemeColors {
  readonly canvas: string;
  readonly surface: string;
  readonly row: string;
  readonly border: string;
  readonly ink: string;
  readonly muted: string;
  readonly action: string;
  readonly onAction: string;
  readonly link: string;
  readonly positive: string;
  readonly positiveSoft: string;
  readonly warning: string;
  readonly warningSoft: string;
  readonly danger: string;
  readonly dangerSoft: string;
  readonly mint: string;
  readonly gold: string;
  readonly sky: string;
  readonly lilac: string;
  readonly logoGreenSoft: string;
  readonly surfaceSoft: string;
}

export const themePalettes: Readonly<Record<'live' | 'simulation', Readonly<Record<'light' | 'dark', ThemeColors>>>> = {
  "live": {
    "light": {
      "canvas": "#ffffff",
      "surface": "#ffffff",
      "row": "#f5f7f6",
      "border": "#e5e5e5",
      "ink": "#222222",
      "muted": "#686868",
      "action": "#174fc7",
      "onAction": "#ffffff",
      "link": "#0037b0",
      "positive": "#00685f",
      "positiveSoft": "#d9f6f1",
      "warning": "#8a5a00",
      "warningSoft": "#fff0cf",
      "danger": "#ba1a1a",
      "dangerSoft": "#ffdad6",
      "mint": "#bcebd3",
      "gold": "#ffe080",
      "sky": "#c4ddfb",
      "lilac": "#dfd2f8",
      "logoGreenSoft": "#e9f6ee",
      "surfaceSoft": "#f7f7f7"
    },
    "dark": {
      "canvas": "#131517",
      "surface": "#1c1f22",
      "row": "#1c1f22",
      "border": "#3a3f45",
      "ink": "#f5f5f5",
      "muted": "#b2b7bd",
      "action": "#225bc6",
      "onAction": "#ffffff",
      "link": "#97bcff",
      "positive": "#75dec7",
      "positiveSoft": "#183d36",
      "warning": "#f5ce86",
      "warningSoft": "#44371f",
      "danger": "#ffaaaa",
      "dangerSoft": "#492a31",
      "mint": "#315e46",
      "gold": "#6a541e",
      "sky": "#2e4e77",
      "lilac": "#51426e",
      "logoGreenSoft": "#20392d",
      "surfaceSoft": "#24272b"
    }
  },
  "simulation": {
    "light": {
      "canvas": "#fffaf2",
      "surface": "#fffdf8",
      "row": "#fff3df",
      "border": "#ead8bd",
      "ink": "#2d1c0d",
      "muted": "#78634e",
      "action": "#8f4700",
      "onAction": "#ffffff",
      "link": "#8f4700",
      "positive": "#00685f",
      "positiveSoft": "#d9f6f1",
      "warning": "#8a5a00",
      "warningSoft": "#fff0cf",
      "danger": "#ba1a1a",
      "dangerSoft": "#ffdad6",
      "mint": "#bcebd3",
      "gold": "#ffe080",
      "sky": "#c4ddfb",
      "lilac": "#dfd2f8",
      "logoGreenSoft": "#e9f6ee",
      "surfaceSoft": "#fff3df"
    },
    "dark": {
      "canvas": "#1d1710",
      "surface": "#271f16",
      "row": "#271f16",
      "border": "#584630",
      "ink": "#fff4df",
      "muted": "#c7b395",
      "action": "#9a5008",
      "onAction": "#ffffff",
      "link": "#ffc06a",
      "positive": "#75dec7",
      "positiveSoft": "#183d36",
      "warning": "#f5ce86",
      "warningSoft": "#44371f",
      "danger": "#ffaaaa",
      "dangerSoft": "#492a31",
      "mint": "#315e46",
      "gold": "#6a541e",
      "sky": "#2e4e77",
      "lilac": "#51426e",
      "logoGreenSoft": "#20392d",
      "surfaceSoft": "#332719"
    }
  }
};

export const themeRadii = {
  "radiusControl": 16,
  "radiusCard": 24,
  "radiusFeature": 28,
  "radiusRow": 20
} as const;

/** Stable area identity, not an action/status legend. Reuse a small restrained
 * palette; glyphs and visible labels communicate the particular action. */
export const productIconIdentityTones = {
  attendance: 'mint', timetable: 'gold', calendar: 'orange', gate: 'teal',
  assessments: 'blue', events: 'violet', messages: 'blue', departure: 'orange',
  reports: 'violet', insights: 'violet', people: 'teal', fees: 'mint',
  resources: 'gold', facilities: 'orange', accommodation: 'violet', dining: 'gold',
  responsibilities: 'violet', care: 'mint', learning: 'blue', campus: 'gold',
  today: 'mint', work: 'gold', areas: 'teal', more: 'blue', profile: 'mint', notifications: 'gold',
} as const;
export type ProductIconIdentity = keyof typeof productIconIdentityTones | 'neutral' | 'brand' | 'status-positive';
const productIconInk = {
  light: { mint: '#2c7758', gold: '#856720', blue: '#3c679a', violet: '#755da5', teal: '#287872', orange: '#996139' },
  dark: { mint: '#83cda8', gold: '#dec17b', blue: '#91b6df', violet: '#baa6dc', teal: '#81c6bf', orange: '#d9ab82' },
} as const;
export function productIconAppearance(area: ProductIconIdentity, colors: ThemeColors, dark = false): { ink: string; fill: string } {
  if (area === 'neutral') return { ink: colors.muted, fill: colors.surfaceSoft };
  if (area === 'status-positive') return { ink: colors.positive, fill: colors.positiveSoft };
  if (area === 'brand') return { ink: colors.ink, fill: 'transparent' };
  return { ink: productIconInk[dark ? 'dark' : 'light'][productIconIdentityTones[area]], fill: colors.surfaceSoft };
}
