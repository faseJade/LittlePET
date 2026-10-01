/**
 * Shared contracts between the main process and the renderer.
 *
 * The main process owns input sampling, time and persistence; the renderer owns
 * simulation and drawing. Everything crossing that line is defined here.
 */

/** Palette slots. A pattern is just a colour assignment per slot (PLAN.md 6.2). */
export const PALETTE_SLOTS = [
  'outline',
  'body',
  'bodyShadow',
  'light',
  'white',
  'patch1',
  'patch2',
  'eye',
  'eyeShine',
  'pink',
  'effect',
  'prop',
] as const;

export type PaletteSlot = (typeof PALETTE_SLOTS)[number];

/** Character used in the authored ASCII art for each slot. '.' is transparent. */
export const SLOT_CHARS = {
  outline: 'K',
  body: 'B',
  bodyShadow: 'b',
  light: 'L',
  white: 'W',
  patch1: 'P',
  patch2: 'p',
  eye: 'E',
  eyeShine: 'e',
  pink: 'N',
  effect: 'S',
  prop: 'T',
} as const satisfies Record<PaletteSlot, string>;

export type SlotChar = '.' | (typeof SLOT_CHARS)[PaletteSlot];

/**
 * An eye socket, in art-grid coordinates.
 *
 * The frames do not contain pupils. Each frame declares where its sockets are and
 * how far a pupil may travel inside them, and the eye layer draws them at runtime
 * (PLAN.md 6.3). That is what makes blinking, eye follow and every expression free
 * instead of a separate hand-drawn frame.
 */
export interface EyeAnchor {
  /** Socket centre, in grid cells from the frame's top-left. */
  readonly x: number;
  readonly y: number;
  /** Socket radius in grid cells; also the clamp on pupil travel. */
  readonly r: number;
}

/** Reverse lookup, plus the transparent sentinel. */
export const CHAR_TO_SLOT: Record<string, PaletteSlot | null> = {
  '.': null,
  ...Object.fromEntries(Object.entries(SLOT_CHARS).map(([slot, ch]) => [ch, slot as PaletteSlot])),
};

export type RGB = readonly [number, number, number];

export type Pattern = Partial<Record<PaletteSlot, RGB>>;

// ---------------------------------------------------------------------------
// Stage geometry
// ---------------------------------------------------------------------------

/** Stage window size in logical pixels. Holds the cat plus its UI furniture. */
export const STAGE_W = 320;
export const STAGE_H = 240;

/** The cat's art grid and its on-screen integer scale. */
export const CAT_SCALE = 3;
export const CAT_W = 144; // 48 * CAT_SCALE
export const CAT_H = 144;

/** Where the cat's art box sits inside the stage, so bubbles fit above it. */
export const CAT_ANCHOR = { x: 16, y: STAGE_H - 16 - CAT_H } as const;

/** The cat grows up to this much for the stretch reminder without clipping. */
export const MAX_STRETCH_SCALE = 1.4;

// ---------------------------------------------------------------------------
// Simulation snapshot: main -> renderer, 60 Hz
// ---------------------------------------------------------------------------

export interface CursorState {
  /**
   * Position *within the stage window*, in logical pixels, origin top-left.
   *
   * Deliberately not screen coordinates. The renderer needs the cursor to test it
   * against the cat's pixel mask and to draw eye direction in stage space, and only
   * main knows the window origin and the display scale factor. Converting here keeps
   * that display arithmetic in one process.
   */
  x: number;
  y: number;
  /** Smoothed movement, in logical pixels per second. */
  speed: number;
  /** False when the cursor is outside the stage window entirely. */
  inside: boolean;
}

export type InputMode = 'passthrough' | 'interactive';

export interface DragState {
  active: boolean;
  /** Window velocity, used by the mochi wobble (PLAN.md 4, feature 03). */
  vx: number;
  vy: number;
}

export interface PetSnapshot {
  /** Monotonic ms, injected so tests are deterministic. */
  t: number;
  cursor: CursorState;
  /**
   * Keys per minute over a sliding window. Derived from key *counts* only - the
   * hook layer never retains key content (PLAN.md 0.3).
   */
  keyRate: number;
  /** Accumulated scroll energy, decays over time. Drives paper unroll. */
  wheelEnergy: number;
  inputMode: InputMode;
  drag: DragState;
  /** False when the native input hook failed to load; see PLAN.md 3.4. */
  hookActive: boolean;
}

// ---------------------------------------------------------------------------
// Renderer -> main
// ---------------------------------------------------------------------------

export type PetCommand =
  | { type: 'inputMode'; mode: InputMode }
  | { type: 'dragStart' }
  | { type: 'dragEnd' }
  | { type: 'hide' }
  | { type: 'show' };

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export interface Reminder {
  id: string;
  enabled: boolean;
  /** Minutes between firings. */
  intervalMin: number;
}

export interface MessageReminder {
  id: string;
  enabled: boolean;
  /** Minutes after midnight, local time. */
  atMinute: number;
  text: string;
}

export interface Settings {
  schemaVersion: number;
  petName: string;
  catId: string;
  patternId: string;
  /** Overrides applied on top of the named pattern. */
  paletteOverride: Pattern;
  scale: number;
  reactionsEnabled: boolean;
  soundEnabled: boolean;
  startAtLogin: boolean;
  peekEnabled: boolean;
  stretchReminder: Reminder;
  waterReminder: Reminder;
  messageReminders: MessageReminder[];
  fixedNote: { enabled: boolean; text: string };
}

export const SETTINGS_VERSION = 1;

export const DEFAULT_SETTINGS: Settings = {
  schemaVersion: SETTINGS_VERSION,
  petName: '',
  catId: 'nunu',
  patternId: 'tuxedo',
  paletteOverride: {},
  scale: CAT_SCALE,
  reactionsEnabled: true,
  soundEnabled: false,
  startAtLogin: false,
  peekEnabled: false,
  stretchReminder: { id: 'stretch', enabled: false, intervalMin: 45 },
  waterReminder: { id: 'water', enabled: false, intervalMin: 60 },
  messageReminders: [],
  fixedNote: { enabled: false, text: '' },
};
