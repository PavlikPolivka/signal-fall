import { parseReplay, type Replay } from './scenario';

/**
 * Saved skirmishes and recent matches, kept in this browser. Both are replays (scenario plus
 * every order): loading one replays the orders to the saved moment.
 */

const SAVE_KEY = 'signalfall.save';
const RECENT_KEY = 'signalfall.recent';
const RECENT_MAX = 5;

export interface SavedMeta {
  /** When it was saved (ms since epoch). */
  at: number;
  /** Match time at the save, ticks. */
  tick: number;
  /** "Holdout vs Choir" and the like. */
  label: string;
}

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/** One save slot: the latest saved skirmish. */
export function saveGame(json: string, meta: SavedMeta): boolean {
  return write(SAVE_KEY, { meta, json });
}

export function savedGame(): { meta: SavedMeta; replay: Replay } | null {
  const s = read<{ meta: SavedMeta; json: string }>(SAVE_KEY);
  if (!s) return null;
  try {
    return { meta: s.meta, replay: parseReplay(s.json) };
  } catch {
    return null;
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    // Nothing to clear.
  }
}

/** Keep the replay of a finished match; the oldest drop off (also when storage is full). */
export function addRecent(json: string, meta: SavedMeta): void {
  const list = read<{ meta: SavedMeta; json: string }[]>(RECENT_KEY) ?? [];
  list.unshift({ meta, json });
  list.length = Math.min(list.length, RECENT_MAX);
  while (list.length > 0 && !write(RECENT_KEY, list)) list.pop();
}

export function recentMatches(): { meta: SavedMeta; json: string }[] {
  return read<{ meta: SavedMeta; json: string }[]>(RECENT_KEY) ?? [];
}

/** "12:34" from ticks. */
export const clock = (ticks: number) => `${Math.floor(ticks / 1200)}:${String(Math.floor(ticks / 20) % 60).padStart(2, '0')}`;

/** Saved hand-made maps in this browser: name -> share code. */
const SAVED_KEY = 'signalfall.maps';

export function savedMaps(): { name: string; code: string }[] {
  try {
    return JSON.parse(localStorage.getItem(SAVED_KEY) ?? '[]') as { name: string; code: string }[];
  } catch {
    return [];
  }
}

export function storeMaps(list: { name: string; code: string }[]): void {
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify(list));
  } catch {
    // Storage full or blocked: the code still works.
  }
}

