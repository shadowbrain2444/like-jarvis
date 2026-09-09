/** VEYRA's maroon/black/white visual identity (spec section 23), as Three.js color values. Mirrors `src/styles/theme.css`. */
export const AVATAR_COLORS = {
  black: 0x0a0505,
  maroonDeep: 0x4a0f1f,
  maroon: 0x7d1935,
  maroonBright: 0xb02b47,
  white: 0xf5eeee,
  whiteDim: 0xcbb8ba,
} as const;

/** Emissive intensity + ring color per assistant state — the avatar's "mood". */
export const STATE_VISUALS: Record<
  string,
  { core: number; ring: number; ringIntensity: number; breathe: number }
> = {
  SLEEPING: { core: AVATAR_COLORS.maroonDeep, ring: AVATAR_COLORS.maroonDeep, ringIntensity: 0.15, breathe: 0.35 },
  ACTIVE: { core: AVATAR_COLORS.maroonBright, ring: AVATAR_COLORS.maroonBright, ringIntensity: 0.9, breathe: 1.2 },
  LISTENING: { core: AVATAR_COLORS.maroon, ring: AVATAR_COLORS.white, ringIntensity: 0.8, breathe: 0.9 },
  THINKING: { core: AVATAR_COLORS.maroon, ring: AVATAR_COLORS.maroonBright, ringIntensity: 0.7, breathe: 0.6 },
  SPEAKING: { core: AVATAR_COLORS.maroonBright, ring: AVATAR_COLORS.white, ringIntensity: 1.0, breathe: 0.7 },
  INTERRUPTED: { core: AVATAR_COLORS.maroonBright, ring: AVATAR_COLORS.white, ringIntensity: 1.0, breathe: 1.0 },
  STOPPING: { core: AVATAR_COLORS.maroon, ring: AVATAR_COLORS.maroonDeep, ringIntensity: 0.4, breathe: 0.5 },
  ERROR: { core: 0x8a1414, ring: 0xc23b3b, ringIntensity: 1.0, breathe: 1.5 },
};
