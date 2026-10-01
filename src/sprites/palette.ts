import type { Pattern } from '../shared/types';

/**
 * Pattern presets.
 *
 * These are *data*, not artwork (PLAN.md 6.2): the cat's ASCII frames index
 * into these slots, so a whole new coat is a dozen hex values. That is the
 * whole reason the art is authored as indexed ASCII rather than PNGs.
 *
 * The base art carries a tuxedo bib, so `patch1` is the dark marking and
 * `body` is the light field. Patterns that invert that swap the two.
 */
export const PATTERNS: Record<string, Pattern> = {
  tuxedo: {
    outline: [32, 26, 30],
    body: [232, 228, 220],
    bodyShadow: [186, 180, 174],
    light: [252, 250, 246],
    white: [255, 255, 255],
    patch1: [58, 52, 58],
    patch2: [96, 88, 96],
    eye: [24, 20, 26],
    eyeShine: [255, 255, 255],
    pink: [236, 148, 158],
  },
  tabby: {
    outline: [56, 40, 24],
    body: [201, 168, 124],
    bodyShadow: [168, 135, 92],
    light: [230, 207, 169],
    white: [240, 226, 200],
    patch1: [138, 102, 64],
    patch2: [169, 135, 87],
    eye: [92, 140, 84],
    eyeShine: [255, 255, 255],
    pink: [230, 150, 150],
  },
  ginger: {
    outline: [92, 52, 20],
    body: [224, 155, 78],
    bodyShadow: [184, 122, 56],
    light: [243, 197, 131],
    white: [250, 226, 186],
    patch1: [201, 124, 51],
    patch2: [216, 147, 63],
    eye: [110, 150, 88],
    eyeShine: [255, 255, 255],
    pink: [238, 152, 156],
  },
  tortoiseshell: {
    outline: [28, 20, 16],
    body: [110, 82, 64],
    bodyShadow: [82, 57, 44],
    light: [192, 139, 90],
    white: [206, 160, 108],
    patch1: [46, 38, 32],
    patch2: [168, 85, 31],
    eye: [176, 132, 62],
    eyeShine: [255, 255, 255],
    pink: [226, 146, 148],
  },
  siamese: {
    outline: [48, 38, 30],
    body: [230, 220, 200],
    bodyShadow: [195, 183, 158],
    light: [247, 240, 226],
    white: [250, 246, 236],
    patch1: [74, 59, 48],
    patch2: [107, 86, 72],
    eye: [96, 148, 196],
    eyeShine: [255, 255, 255],
    pink: [236, 150, 158],
  },
  calico: {
    outline: [44, 34, 30],
    body: [242, 237, 228],
    bodyShadow: [207, 199, 186],
    light: [255, 252, 246],
    white: [255, 255, 255],
    patch1: [224, 138, 60],
    patch2: [58, 52, 58],
    eye: [150, 168, 90],
    eyeShine: [255, 255, 255],
    pink: [238, 154, 160],
  },
  black: {
    outline: [18, 18, 22],
    body: [74, 74, 82],
    bodyShadow: [51, 51, 58],
    light: [110, 110, 120],
    white: [130, 130, 140],
    patch1: [42, 42, 48],
    patch2: [60, 60, 68],
    eye: [214, 176, 64],
    eyeShine: [255, 255, 255],
    pink: [200, 140, 150],
  },
  grey: {
    outline: [40, 40, 48],
    body: [168, 168, 176],
    bodyShadow: [134, 134, 142],
    light: [200, 200, 208],
    white: [216, 216, 224],
    patch1: [110, 110, 120],
    patch2: [140, 140, 150],
    eye: [128, 176, 96],
    eyeShine: [255, 255, 255],
    pink: [232, 158, 164],
  },
};

/** Slots that are not part of the coat, so patterns cannot accidentally recolour them. */
export const FIXED_SLOTS = {
  eyeShine: [255, 255, 255] as const,
  effect: [255, 120, 120] as const,
  prop: [220, 200, 160] as const,
};

export const DEFAULT_PATTERN_ID = 'tuxedo';

export function resolvePalette(patternId: string, override: Pattern = {}): Pattern {
  const base = PATTERNS[patternId] ?? PATTERNS[DEFAULT_PATTERN_ID]!;
  return { ...base, ...override };
}
