import { KIND } from '../entities';
import type { World } from '../world';
import { HILL_TICKS } from './points';
import { hordeBeaten } from './survival';

/**
 * A player is defeated when they have no structures and no construction units
 * left (or surrendered). The match ends when at most one team remains.
 */
export function victorySystem(world: World): void {
  if (world.ended) return;
  const e = world.entities;
  if (world.victoryRules) {
    const hasBase = world.players.map(() => false);
    for (let s = 0; s < e.high; s++) {
      if (e.alive[s] !== 1) continue;
      const owner = e.owner[s]!;
      if (e.kind[s] === KIND.structure) hasBase[owner] = true;
      else if (e.kind[s] === KIND.unit && e.type[s] === world.rules.factions[world.players[owner]!.faction]!.constructionUnit) hasBase[owner] = true;
      // A squad mission: the player has no base to lose, only soldiers.
      else if (e.kind[s] === KIND.unit && owner === 0 && world.mission?.rules.squad) hasBase[0] = true;
    }
    // The survival horde has no base to lose.
    for (const p of world.players) if (!hasBase[p.index] && p.index !== world.survival?.horde) p.defeated = true;
  }
  if (world.survival) {
    // Every wave held off: the defenders win.
    if (hordeBeaten(world)) {
      world.ended = true;
      world.winnerTeam = world.players.find((p) => p.index !== world.survival!.horde)!.team;
      return;
    }
  }
  // A mission ends by its own objectives, or when the player has nothing left.
  if (world.mission) {
    if (world.players[0]!.defeated) {
      world.ended = true;
      world.winnerTeam = world.players.find((p) => p.team !== world.players[0]!.team)?.team ?? -1;
    }
    return;
  }
  const teamsAtStart = new Set(world.players.map((p) => p.team));
  if (teamsAtStart.size < 2) return;
  // King of the hill: holding the hill long enough wins outright.
  for (let t = 0; t < world.hillScore.length; t++)
    if (world.hillScore[t]! >= HILL_TICKS) {
      world.ended = true;
      world.winnerTeam = t;
      return;
    }
  const remaining = new Set(world.players.filter((p) => !p.defeated).map((p) => p.team));
  if (remaining.size <= 1) {
    world.ended = true;
    world.winnerTeam = remaining.size === 1 ? remaining.values().next().value! : -1;
  }
}
