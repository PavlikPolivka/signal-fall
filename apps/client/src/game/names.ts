import type { Rules } from '@signal-fall/data';

/** Generic role labels, for the rare role a faction has no building for. */
const ROLE_FALLBACK: Record<string, string> = {
  conyard: 'Construction Yard',
  power: 'Power',
  refinery: 'Refinery',
  barracks: 'Barracks',
  factory: 'Vehicle Factory',
  radar: 'Radar',
  special: 'Faction special',
  airfield: 'Airfield',
  tech: 'Tech Center',
  defense: 'Defense',
  antiAir: 'Anti-air',
  heavyDefense: 'Heavy defense',
  wall: 'Wall',
  superweapon: 'Superweapon',
};

/** The name of a faction's building that fills a role (Holdout "barracks" = Bunkhouse, Halcyon = spawn, Choir = Loft). */
export function roleName(rules: Rules, faction: number, role: string): string {
  const f = rules.factions[faction];
  const s = f?.structures.map((i) => rules.structures[i]!).find((r) => r.role === role);
  return s?.name ?? ROLE_FALLBACK[role] ?? role;
}

/** "Bunkhouse and Radio Mast" style list of the buildings for roles. */
export function roleNames(rules: Rules, faction: number, roles: readonly string[]): string {
  const names = roles.map((r) => roleName(rules, faction, r));
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** Generic role label (Codex column headers etc.). */
export function roleLabel(role: string): string {
  return ROLE_FALLBACK[role] ?? role;
}

/** The credit mark: an Echo crystal, not a dollar sign. */
export const CREDIT = '◆';
/** An amount of credits for display, e.g. "◆1,200". */
export const money = (n: number): string => `${CREDIT}${n.toLocaleString('en-US')}`;
