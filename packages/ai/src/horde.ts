import { idiv, ilength, KIND, type Brain, type Command, type World } from '@signal-fall/sim';

/**
 * The survival horde's brain: every unit without orders attack-moves on the nearest building of
 * the defenders (or their nearest unit once the buildings are gone). It knows where the bases are:
 * it is a scripted enemy, not a player.
 */
export class HordeBrain implements Brain {
  constructor(readonly player: number) {}

  think(world: World): Command[] {
    const e = world.entities;
    const idle: number[] = [];
    let cx = 0;
    let cy = 0;
    for (let s = 0; s < e.high; s++) {
      if (e.alive[s] !== 1 || e.owner[s] !== this.player || e.kind[s] !== KIND.unit) continue;
      if (e.orders[s]!.length > 0) continue;
      idle.push(e.handle(s));
      cx += e.x[s]!;
      cy += e.y[s]!;
    }
    if (idle.length === 0) return [];
    cx = idiv(cx, idle.length);
    cy = idiv(cy, idle.length);
    let best = -1;
    let bestD = 0;
    for (const want of [KIND.structure, KIND.unit]) {
      for (let s = 0; s < e.high; s++) {
        if (e.alive[s] !== 1 || e.kind[s] !== want || e.owner[s] === this.player || e.owner[s]! < 0) continue;
        const d = ilength(e.x[s]! - cx, e.y[s]! - cy);
        if (best < 0 || d < bestD) {
          best = s;
          bestD = d;
        }
      }
      if (best >= 0) break;
    }
    if (best < 0) return [];
    return [{ type: 'attackMove', units: idle, x: e.x[best]!, y: e.y[best]! }];
  }
}
