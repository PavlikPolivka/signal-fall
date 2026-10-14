/**
 * The Signal Fall mark: a signal-strength meter whose last bar is falling away.
 * Single source of truth for the in-game logo and the design kit (brand/).
 * Every shape stays inside the 46 x 40 view box (the falling bar is rotated
 * about its own center, so no corner is ever clipped).
 */
export const MARK_VIEWBOX = { width: 46, height: 40 };

export const MARK_BARS = [
  { x: 2, y: 26, width: 7, height: 10, opacity: 1 },
  { x: 12, y: 18, width: 7, height: 18, opacity: 1 },
  { x: 22, y: 10, width: 7, height: 26, opacity: 0.85 },
] as const;

/** The falling bar, in the signal (cyan) color. */
export const MARK_FALLING = { x: 33.5, y: 8, width: 7, height: 22, angle: 24, cx: 37, cy: 19 } as const;

export const BRAND_COLORS = {
  /** Gold: the mark's bars and "Signal". */
  gold: '#e8c35a',
  /** Off-white: "Fall". */
  bone: '#f2efe6',
  /** Signal cyan: the falling bar (also the color of Echo). */
  signal: '#3ee6ff',
  /** Night: backgrounds. */
  night: '#0a0c10',
} as const;
