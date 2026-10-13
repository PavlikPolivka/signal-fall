import { ARMOR, DAMAGE, type Rules } from '@signal-fall/data';
import { roleName } from './observe';

const r1 = (n: number) => Math.round(n * 10) / 10;

/** A faction's roster and the combat basics, in plain units (tiles, seconds), for agents. */
export function rulesDigest(rules: Rules, factionId?: string) {
  const fx = 1024;
  const rate = rules.constants.tickRate;
  const factions = rules.factions.filter((f) => !factionId || f.id === factionId);
  const weapon = (w: Rules['units'][number]['weapon']) =>
    w && {
      damage: w.damage,
      type: DAMAGE[w.type],
      range: r1(w.range / fx),
      cooldown_s: r1(w.cooldown / rate),
      targets: w.targetsGround && w.targetsAir ? 'ground+air' : w.targetsAir ? 'air' : 'ground',
      ...(w.splash ? { splash: r1(w.splash / fx) } : {}),
    };
  return {
    time: `${rate} ticks per second; a turn is a fixed number of ticks set when the match is created`,
    start_credits: rules.constants.startCredits,
    unit_cap: rules.constants.unitCap,
    damage_vs_armor_pct: Object.fromEntries(DAMAGE.map((d, i) => [d, Object.fromEntries(ARMOR.map((a, j) => [a, rules.damageMatrix[i * ARMOR.length + j]]))])),
    factions: factions.map((f) => ({
      id: f.id,
      name: f.name,
      placement:
        f.placement === 'adjacent'
          ? `structures must be within ${f.adjacencyRange} tiles of your other structures`
          : f.placement === 'coverage'
            ? 'structures must be inside network coverage (radius around nodes and the core)'
            : 'structures grow near Echo fields or other Choir structures',
      construction_vehicle: rules.units[f.constructionUnit]!.id,
      harvester: rules.units[f.harvester]!.id,
      structures: f.structures
        .map((i) => rules.structures[i]!)
        .filter((s) => s.category)
        .map((s) => ({
          id: s.id,
          name: s.name,
          category: s.category,
          role: s.role,
          does: s.description,
          cost: s.cost,
          build_s: r1(s.buildTicks / rate),
          power: s.power,
          footprint: `${s.footprintW}x${s.footprintH}`,
          hp: s.hp,
          requires: s.requires.map((r) => roleName(rules, f.index, r)),
          ...(s.produces ? { produces: s.produces } : {}),
          ...(s.weapon ? { weapon: weapon(s.weapon) } : {}),
        })),
      units: f.units
        .map((i) => rules.units[i]!)
        .map((u) => ({
          id: u.id,
          name: u.name,
          tab: u.tab,
          does: u.role,
          cost: u.cost,
          build_s: r1(u.buildTicks / rate),
          hp: u.hp,
          ...(u.shields ? { shields: u.shields } : {}),
          armor: ARMOR[u.armor],
          speed: r1((u.speed * rate) / fx),
          sight: r1(u.sight / fx),
          weapon: weapon(u.weapon),
          requires: u.requires.map((r) => roleName(rules, f.index, r)),
          abilities: u.abilities.map((a) => a.kind),
        })),
      upgrades: rules.upgrades
        .filter((u) => u.faction === -1 || u.faction === f.index)
        .map((u) => ({ id: u.id, name: u.name, cost: u.cost, research_s: r1(u.researchTicks / rate), requires: u.requires.map((r) => roleName(rules, f.index, r)), effect: u.effect })),
    })),
  };
}

/** How to play, for an agent reading this cold. */
export const GUIDE = `Signal Fall is a real-time strategy game (Command & Conquer style). Destroy every enemy structure and unit to win.

Economy: harvesters gather Echo crystals and unload at your refinery for credits. Building costs credits continuously while it progresses.
Power: structures use power; power plants produce it. Below zero, production slows and defenses weaken.

Opening that works:
1. "deploy" your construction vehicle (it becomes your construction yard).
2. "build" a power structure, then "place" it when the queue says ready. Then a refinery (comes with a harvester), then a barracks / factory.
3. "train" units at the factory for their tab (infantry, vehicles, air). Several harvesters (2-3 per refinery) grow income.
4. Scout (map.starts lists every start position), defend, then "attack_move" with a large army.

Turns: act (queue commands), then end_turn: the game runs a few seconds and you get the new observation.
Coordinates are tiles [x, y]; ids come from the observation. Unit lists accept ids or "army", "idle_army", "harvesters", "type:<unit id>".
"place" without "at" picks a free spot near your construction yard; "at" places near that tile instead.
Rock-paper-scissors: see damage_vs_armor_pct in get_rules. Mixed armies beat single-type armies.`;
