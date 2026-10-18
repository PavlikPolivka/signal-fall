import type { Keymap } from '@signal-fall/data';

export interface Chord {
  code: string;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  /** True for "Digit#" / "F#" chords; the number is reported separately. */
  anyDigit: boolean;
}

export type Context = 'global' | 'units' | 'base';

export interface Binding {
  context: Context;
  action: string;
  chord: Chord;
}

export function parseChord(s: string): Chord {
  const parts = s.split('+');
  const code = parts.pop()!;
  return {
    code,
    ctrl: parts.includes('Ctrl'),
    shift: parts.includes('Shift'),
    alt: parts.includes('Alt'),
    anyDigit: code.endsWith('#'),
  };
}

export function bindings(keymap: Keymap): Binding[] {
  const out: Binding[] = [];
  for (const context of ['global', 'units', 'base'] as const) {
    for (const [action, chords] of Object.entries(keymap[context])) {
      for (const c of chords) out.push({ context, action, chord: parseChord(c) });
    }
  }
  return out;
}

export interface KeyLike {
  code: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

/**
 * Does the event match the chord? Ctrl and Alt must match exactly. Shift must
 * match exactly for chords that use it; for plain chords Shift is allowed so
 * it can act as the queue modifier.
 */
export function matches(chord: Chord, ev: KeyLike): number | boolean {
  const ctrl = ev.ctrlKey || ev.metaKey;
  if (chord.ctrl !== ctrl || chord.alt !== ev.altKey) return false;
  if (chord.shift && !ev.shiftKey) return false;
  if (chord.anyDigit) {
    const m = chord.code === 'F#' ? /^F([1-4])$/.exec(ev.code) : /^Digit([0-9])$/.exec(ev.code);
    if (!m) return false;
    // Shift+Digit is its own chord (add to group); plain Digit must not have Shift.
    if (!chord.shift && ev.shiftKey) return false;
    return Number(m[1]);
  }
  return chord.code === ev.code;
}

/** Human label for a chord, e.g. "Ctrl+1–9" or "A". */
export function chordLabel(s: string): string {
  return s
    .replace('Digit#', '0–9')
    .replace('F#', 'F1–F4')
    .replace('Equal', '=')
    .replace('Minus', '-')
    .replace(/Key([A-Z])/, '$1')
    .replace(/^Arrow/, '')
    .replace('Escape', 'Esc');
}

/** The keymap with the player's own bindings (action -> chords) laid over the defaults. */
export function withOverrides(keymap: Keymap, overrides: Record<string, string[]>): Keymap {
  const out = { ...keymap, global: { ...keymap.global }, units: { ...keymap.units }, base: { ...keymap.base } };
  for (const ctx of ['global', 'units', 'base'] as const)
    for (const action of Object.keys(out[ctx])) if (overrides[action]?.length) out[ctx][action] = overrides[action];
  return out;
}

/** The chord a key press makes ("Ctrl+KeyQ"), or null for a lone modifier. */
export function chordOf(e: KeyLike): string | null {
  if (/^(Control|Shift|Alt|Meta)(Left|Right)$/.test(e.code)) return null;
  return [e.ctrlKey || e.metaKey ? 'Ctrl' : '', e.shiftKey ? 'Shift' : '', e.altKey ? 'Alt' : '', e.code].filter(Boolean).join('+');
}
