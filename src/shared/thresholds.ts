/**
 * Every tunable number in one place (PLAN.md 5.2), so behaviour can be adjusted
 * without hunting through logic. All rates are keys-per-minute.
 */
export const THRESHOLDS = {
  /** Cursor px/frame above which the cat considers chasing. */
  HUNT_SPEED: 55,

  /** Ordinary typing starts the kneading reaction. */
  TYPING_ACTIVE: 40,
  /** Fast typing; distinct from overheat so the cat can look busy first. */
  TYPING_FAST: 180,

  /** Overheat must be *sustained*, or every typing burst overheats the cat. */
  OVERHEAT_ENTER_RATE: 240,
  OVERHEAT_ENTER_SEC: 3,
  /** Hysteresis on the way back down stops the mode flickering. */
  OVERHEAT_EXIT_RATE: 120,
  OVERHEAT_EXIT_SEC: 5,

  /** Scroll energy that makes the paper roll run out and reset. */
  UNROLL_ENERGY: 90,
  /** Energy bleed per second. */
  UNROLL_DECAY: 6,

  /** Idle seconds before the cat falls asleep. */
  IDLE_SLEEP: 180,

  /** Pupil easing: fraction of the remaining gap closed per second. */
  PUPIL_EASE: 14,
  /** Maximum pupil offset from the eye centre, in art pixels. */
  PUPIL_MAX_OFFSET: 1.6,

  /** Blink: seconds between attempts, and how long the lids stay shut. */
  BLINK_MIN_GAP: 2.5,
  BLINK_MAX_GAP: 6.5,
  BLINK_DURATION: 0.12,

  /** Click-through hysteresis, in frames. Prevents flicker on fast movement. */
  HIT_ENTER_FRAMES: 2,
  HIT_EXIT_FRAMES: 4,
  /** Padding around the cat's opaque mask, in physical pixels. */
  HIT_PAD_PX: 2,

  /** Walk speed, physical px/second. */
  WALK_SPEED: 34,
  /** Idle-life director: minimum seconds between spontaneous animations. */
  IDLE_MIN_GAP: 6,
  IDLE_MAX_GAP: 16,
} as const;

/** Physics constants for the mochi drag (feature 03). */
export interface MochiConstants {
  /** Stiffness of the squash/stretch spring. */
  STIFFNESS: number;
  DAMPING: number;
  /** How much of the drag velocity converts into lateral wobble. */
  WOBBLE_GAIN: number;
  /**
   * Angular frequency of the wobble, rad/s. 7.5 is ~1.2 Hz, so a 2-3 Hz hand shake
   * lands near the top of the response.
   */
  WOBBLE_FREQ: number;
  /**
   * Damping of the wobble, as a velocity coefficient. Critical damping would be
   * `2 * WOBBLE_FREQ` (15); 6 sits well under it, so the cat rocks for two or three
   * cycles and then settles. Much above ~12 and the motion goes overdamped: the cat
   * leans into a drag and stops dead instead of jiggling.
   */
  WOBBLE_DAMP: number;
  /** Clamp so the cat never turns into a streak. */
  MAX_SCALE_X: number;
  MAX_SCALE_Y: number;
  /** Settle squash on landing. */
  DROP_SQUASH: number;
}

/**
 * Typed as an interface rather than `as const` so callers can pass a strength
 * argument of type `number`; a literal-typed constant rejects every value but
 * 0.18, which reads as a bug rather than as intent.
 */
export const MOCHI: MochiConstants = {
  STIFFNESS: 190,
  DAMPING: 14,
  WOBBLE_GAIN: 0.022,
  WOBBLE_FREQ: 7.5,
  WOBBLE_DAMP: 6,
  MAX_SCALE_X: 1.22,
  MAX_SCALE_Y: 1.3,
  DROP_SQUASH: 0.18,
};
