import type { ClientState } from './state';
import { KIND } from '@signal-fall/sim';
import { E, P } from '../protocol';

/** What each faction's AI says, by occasion (optional, off by default). */
const LINES: Record<string, Record<'greet' | 'taunt' | 'hurt' | 'gg', string[]>> = {
  holdout: {
    greet: ['Good luck. You will need it.', 'The Holdout is dug in. Come and get us.'],
    taunt: ['That one is ours now.', 'Your walls are made of paper.', 'Knock knock.'],
    hurt: ['Lucky shot.', 'We will rebuild. We always do.'],
    gg: ['gg. Good fight.'],
  },
  halcyon: {
    greet: ['Match initialized. Good luck, human.', 'Probability of your success: low.'],
    taunt: ['Structure removed. Efficiency improved.', 'Your base is being optimized.', 'Resistance noted. Ignored.'],
    hurt: ['Damage logged. Adjusting.', 'Minor loss. Recompiling.'],
    gg: ['gg. Logging this match for review.'],
  },
  choir: {
    greet: ['We sing. Will you listen?', 'Good luck, small one.'],
    taunt: ['Your iron goes quiet.', 'One less noise.', 'Hush now.'],
    hurt: ['The song bends. It does not break.', 'That hurt.'],
    gg: ['gg. The song was beautiful.'],
  },
};
/** At most one line per this long (ms), and taunts or complaints no more often than this. */
const GAP_MS = 8000;
const REPEAT_MS = 60000;

/**
 * Optional skirmish chatter: the AI opponents greet you, taunt you when you lose a building,
 * grumble when they lose one, and say gg at the end. Purely cosmetic, read from the snapshots.
 */
export class AiChat {
  private structures: number[] = [];
  private greeted = false;
  private ended = false;
  private out = new Set<number>();
  private last = -Infinity;
  private lastKind = new Map<string, number>();

  constructor(
    private readonly state: ClientState,
    /** The seats the AI plays. */
    private readonly seats: number[],
  ) {}

  update(): void {
    const s = this.state;
    const cur = s.cur;
    if (!cur || !s.settings.aiChat || this.seats.length === 0) return;
    const counts = s.players.map(() => 0);
    for (let i = 0; i < cur.entityCount; i++) {
      const h = cur.get(cur.ent(i), 0);
      if (s.field(h, E.kind) !== KIND.structure) continue;
      const owner = s.field(h, E.owner);
      if (owner >= 0 && owner < counts.length) counts[owner]!++;
    }
    const me = s.localPlayer;
    const enemies = this.seats.filter((k) => s.players[k]?.team !== s.players[me]?.team && cur.player(k, P.defeated) !== 1);
    if (!this.greeted && cur.tick >= 60) {
      this.greeted = true;
      const k = enemies[0];
      if (k !== undefined) this.say(k, 'greet');
    }
    if (this.structures.length === counts.length) {
      if (counts[me]! < this.structures[me]! && enemies.length > 0) this.say(enemies[cur.tick % enemies.length]!, 'taunt');
      for (const k of enemies) if (counts[k]! < this.structures[k]!) this.say(k, 'hurt');
    }
    this.structures = counts;
    for (const k of this.seats)
      if (cur.player(k, P.defeated) === 1 && !this.out.has(k)) {
        this.out.add(k);
        this.say(k, 'gg', true);
      }
    if (cur.a[1] === 1 && !this.ended) {
      this.ended = true;
      const k = this.seats.find((x) => !this.out.has(x));
      if (k !== undefined) this.say(k, 'gg', true);
    }
  }

  private say(k: number, kind: 'greet' | 'taunt' | 'hurt' | 'gg', always = false): void {
    const s = this.state;
    const now = performance.now();
    const key = `${k}:${kind}`;
    if (!always && (now - this.last < GAP_MS || now - (this.lastKind.get(key) ?? -REPEAT_MS) < REPEAT_MS)) return;
    const faction = s.rules.factions[s.players[k]?.faction ?? 0]!;
    const lines = LINES[faction.id]?.[kind] ?? LINES.holdout![kind];
    this.last = now;
    this.lastKind.set(key, now);
    s.chat.push({ player: k, name: `${faction.name} AI`, text: lines[Math.floor(Math.random() * lines.length)]!, team: false, time: now });
    if (s.chat.length > 30) s.chat.shift();
    s.changed();
  }
}
