import { ARMOR, type AiProfile, type Role, type StructureRule, type UnitRule } from '@signal-fall/data';
import {
  FOG_VISIBLE,
  FX_HALF,
  FX_ONE,
  FX_SHIFT,
  KIND,
  POINT,
  canResearch,
  computeFacts,
  inCoverage,
  nearOwnStructure,
  powerReady,
  superweaponStatus,
  costOf,
  AWAKEN_HOME_RANGE,
  idiv,
  teamOf,
  ilength,
  placementError,
  footprintBlocked,
  pct,
  visibleTo,
  worldPlacementView,
  type Brain,
  type Command,
  type Directives,
  type PlacementView,
  type World,
} from '@signal-fall/sim';
import { PROFILES, type Difficulty, type DifficultyProfile } from './difficulty';
import { STRATEGIES, STRATEGY_POOL, type Strategy, type StrategyName } from './strategy';

const MINUTE = 1200;
/** Forget enemies not seen for this long. */
const MEMORY_TICKS = 3 * MINUTE;
/** A structure counts as under attack if hit this recently. */
const UNDER_ATTACK_TICKS = 40;
/** Hard+ attacks only with twice the army value of the largest enemy army it has seen (x10). */
const ADVANTAGE_X10 = 20;
/** More harvesters than this just crowd the fields. */
const MAX_HARVESTERS = 8;
/** Credits that count as piling up: time for more production. */
const FLOAT_CREDITS = 2500;
/** Most barracks and most factories the AI builds. */
const MAX_PRODUCTION = 3;
/** Most of each support unit (no weapon) alive or queued. */
const SUPPORT_CAP = 2;
/** Max commands per think, even with APM budget saved up. */
const MAX_ACTIONS_PER_THINK = 6;
const AIR_ARMOR = ARMOR.indexOf('air');
/** Keep this much money before starting research. */
const RESEARCH_RESERVE = 1500;
/** Override is wasted on cheap units. */
const OVERRIDE_MIN_COST = 700;

interface Sighting {
  firstSeen: number;
  lastSeen: number;
  x: number;
  y: number;
  owner: number;
  armor: number;
  cost: number;
  structure: boolean;
  harvester: boolean;
  armed: boolean;
  /** Share of its life (percent) that is shields, which take damage by type differently. */
  shieldShare: number;
}

interface Own {
  structures: number[];
  byRole: Map<Role, number[]>;
  units: number[];
  army: number[];
  harvesters: number[];
  constructionUnits: number[];
  conyards: number[];
}

/**
 * Deterministic AI player. It only reads what its player could know (own
 * entities, enemies currently in its fog-of-war vision, remembered sightings,
 * and the static map/start positions every player gets in the lobby) and acts
 * only through commands, limited by an APM budget.
 */
export class AiPlayer implements Brain {
  readonly player: number;
  readonly difficulty: Difficulty;
  private d: DifficultyProfile;
  private profile: AiProfile;
  /** This match's plan, picked on the first think (seeded, so replays reproduce it). */
  strategy: Strategy = STRATEGIES.balanced;
  private strategyChosen = false;
  /** Expansion: the construction vehicle on its way, and where to. */
  private expander = -1;
  private expandTarget: { x: number; y: number } | null = null;
  private expandStuck = 0;
  private readonly enemyStarts: { x: number; y: number }[];
  private readonly home: { x: number; y: number };

  private actionsUsed = 0;
  private memory = new Map<number, Sighting>();
  private nextBuildTick = 0;
  private waveIndex = 0;
  private nextWaveTick = 0;
  private attacking = false;
  private waveStartValue = 0;
  private waveUnits = new Set<number>();
  private scoutHandle = -1;
  private scoutSentTick = -MINUTE * 10;
  private raiders = new Set<number>();
  /** A small squad that takes and holds capture points (maps that have them). */
  private holders = new Set<number>();
  private holdTarget = -1;
  private ralliedFactories = new Set<number>();
  private lastRally = { x: -1, y: -1 };
  private cmds: Command[] = [];
  /** Largest enemy army value seen, fading 1% per think (a pessimistic estimate of what's out there). */
  private peakEnemyArmy = 0;
  private budget = 0;
  /**
   * Directed (an AI agent's autopilot): the player's directives replace the faction profile
   * and the attack logic. Without directives yet, it builds up its economy and stays home.
   */
  private readonly directed: boolean;
  /** This think's plan (directed only). */
  private plan: Directives = {};

  /** A personality picked in the setup instead of drawn at random. */
  private readonly forced: StrategyName | null;

  constructor(opts: { player: number; difficulty: Difficulty; profile: AiProfile; starts: { x: number; y: number }[]; directed?: boolean; strategy?: StrategyName }) {
    this.forced = opts.strategy ?? null;
    this.player = opts.player;
    this.difficulty = opts.difficulty;
    this.d = PROFILES[opts.difficulty];
    this.profile = opts.profile;
    this.directed = opts.directed ?? false;
    this.home = opts.starts[opts.player]!;
    this.enemyStarts = opts.starts.filter((_, i) => i !== opts.player);
    this.nextWaveTick = this.d.firstAttackTick;
  }

  think(world: World): Command[] {
    this.cmds = [];
    const allowed = idiv(this.d.apm * world.tick, MINUTE) - this.actionsUsed;
    this.budget = Math.min(MAX_ACTIONS_PER_THINK, allowed);
    if (!this.strategyChosen) this.chooseStrategy(world);
    this.remember(world);
    if (this.directed) this.plan = world.players[this.player]!.directives ?? { posture: 'defend' };
    this.peakEnemyArmy = Math.max(this.knownEnemyArmy(world), this.peakEnemyArmy - idiv(this.peakEnemyArmy, 100));
    const own = this.survey(world);

    this.deploy(world, own);
    if (this.recover(world, own)) return this.cmds;
    this.expand(world, own);
    this.placeReady(world, own);
    this.construct(world, own);
    this.produce(world, own);
    this.research(world, own);
    this.abilities(world, own);
    this.rally(world, own);
    this.defend(world, own);
    this.scout(world, own);
    this.harass(world, own);
    this.capturePoints(world, own);
    this.pickCrates(world, own);
    this.waves(world, own);
    return this.cmds;
  }

  /** Issue a command if the APM budget allows. */
  private act(cmd: Command): boolean {
    if (this.budget <= 0) return false;
    this.budget--;
    this.actionsUsed++;
    this.cmds.push(cmd);
    return true;
  }

  // --- perception ---

  private remember(world: World): void {
    const e = world.entities;
    const myTeam = world.players[this.player]!.team;
    for (let s = 0; s < e.high; s++) {
      if (e.alive[s] !== 1) continue;
      const k = e.kind[s];
      if (k !== KIND.unit && k !== KIND.structure) continue;
      const owner = e.owner[s]!;
      if (world.players[owner]!.team === myTeam) continue;
      if (!visibleTo(world, this.player, s)) continue;
      const h = e.handle(s);
      const prev = this.memory.get(h);
      const isUnit = k === KIND.unit;
      const urule = isUnit ? world.rules.units[e.type[s]!]! : null;
      const srule = isUnit ? null : world.rules.structures[e.type[s]!]!;
      this.memory.set(h, {
        firstSeen: prev ? prev.firstSeen : world.tick,
        lastSeen: world.tick,
        x: e.x[s]!,
        y: e.y[s]!,
        owner,
        armor: urule ? urule.armor : ARMOR.length - 1,
        cost: urule ? urule.cost : srule!.cost,
        structure: !isUnit,
        harvester: urule ? urule.abilities.some((a) => a.kind === 'harvest') : false,
        armed: urule ? urule.weapon !== null : srule!.weapon !== null,
        shieldShare: urule && urule.shields > 0 ? idiv(urule.shields * 100, urule.shields + urule.hp) : 0,
      });
    }
    // Forget what's stale, and what we can now see is gone (its last-known spot is visible but it isn't there).
    const fog = world.fog[this.player]!;
    const w = world.map.width;
    for (const [h, m] of this.memory) {
      const spotVisible = (fog[(m.y >> FX_SHIFT) * w + (m.x >> FX_SHIFT)]! & 1) === 1;
      if (world.tick - m.lastSeen > MEMORY_TICKS || (spotVisible && m.lastSeen !== world.tick)) this.memory.delete(h);
    }
  }

  /** Known enemies we have had time to react to. */
  private known(world: World): Sighting[] {
    const out: Sighting[] = [];
    for (const m of this.memory.values()) if (world.tick - m.firstSeen >= this.d.reactionTicks) out.push(m);
    return out;
  }

  /** Pick this match's strategy and fold it into the profile and difficulty numbers. */
  private chooseStrategy(world: World): void {
    this.strategyChosen = true;
    if (this.directed) return;
    const pool = STRATEGY_POOL[this.difficulty]!;
    // The draw happens either way, so the AI's random stream stays the same.
    const drawn = pool[world.aiRng[this.player]!.int(pool.length)]!;
    const st = STRATEGIES[this.forced ?? drawn];
    this.strategy = st;
    const base = this.d;
    this.d = {
      ...base,
      firstWave: idiv(base.firstWave * st.firstWavePct, 100),
      waveGrowth: idiv(base.waveGrowth * st.waveGrowthPct, 100),
      firstAttackTick: Math.max(2 * MINUTE + idiv(MINUTE, 2), base.firstAttackTick + st.attackDelay),
      harass: base.harass || (st.harass && this.difficulty !== 'easy'),
      maxRefineries: base.maxRefineries + st.extraRefineries,
      defenses: base.defenses + st.extraDefenses.length,
    };
    const rules = world.rules;
    this.profile = {
      ...this.profile,
      opening: st.opening(this.profile.opening),
      defenses: [...this.profile.defenses, ...st.extraDefenses],
      maxRefineries: this.profile.maxRefineries + st.extraRefineries,
      army: this.profile.army.map(([id, w]) => [id, Math.max(0, idiv(w * st.weightPct(rules.units[rules.unitIndex.get(id)!]!), 100))] as [string, number]),
    };
    this.nextWaveTick = this.d.firstAttackTick;
  }

  /**
   * Expansion (Normal and up): once the strategy says so, build a construction vehicle, drive it
   * to the best Echo field we do not hold and nobody hostile is known near, deploy it there, and
   * the next refinery goes up beside it.
   */
  private expand(world: World, own: Own): void {
    if (this.directed || this.difficulty === 'easy' || own.conyards.length === 0) return;
    const e = world.entities;
    const p = world.players[this.player]!;
    const faction = world.rules.factions[p.faction]!;
    const cv = world.rules.units[faction.constructionUnit]!;
    // An expander on its way: deploy on arrival, give up if it cannot get there.
    if (this.expander >= 0) {
      const s = e.resolve(this.expander);
      if (s < 0 || !this.expandTarget) {
        this.expander = -1;
        return;
      }
      const d = ilength(e.x[s]! - this.expandTarget.x, e.y[s]! - this.expandTarget.y);
      if (d <= 3 * FX_ONE || (this.expandStuck > 30 && e.orders[s]!.length === 0)) {
        this.act({ type: 'deploy', units: [this.expander] });
        // If the spot is blocked the deploy does nothing: step aside and try again.
        if ((world.tick + this.player) % 50 === 0) this.act({ type: 'move', units: [this.expander], x: this.expandTarget.x + FX_ONE * 2, y: this.expandTarget.y });
        this.expandStuck++;
        return;
      }
      if (e.orders[s]!.length === 0) {
        this.expandStuck++;
        this.act({ type: 'move', units: [this.expander], x: this.expandTarget.x, y: this.expandTarget.y });
      }
      return;
    }
    // A fresh construction vehicle (beyond the one we deployed at the start) becomes the expander.
    const spare = own.constructionUnits[0];
    if (spare !== undefined && own.conyards.length > 0) {
      const target = this.expansionSite(world, own);
      if (!target) return;
      this.expander = e.handle(spare);
      this.expandTarget = target;
      this.expandStuck = 0;
      this.act({ type: 'move', units: [this.expander], x: target.x, y: target.y });
      return;
    }
    // Time to expand? Only with a factory, some money and room for another refinery.
    if (world.tick < this.strategy.expandAt || this.count(own, 'factory') === 0) return;
    if (this.count(own, 'refinery') >= Math.min(this.profile.maxRefineries, this.d.maxRefineries)) return;
    if (own.conyards.length >= 3) return;
    const vq = p.production[1]!;
    if (vq.items.includes(cv.index) || !cv.requires.every((r) => this.count(own, r) > 0)) return;
    if (!this.expansionSite(world, own)) return;
    this.act({ type: 'train', item: cv.index, count: 1 });
  }

  /** Echo clusters on the map: centers (Q10) and how much they hold, coarse grid (cached per second). */
  private clusterCache: { tick: number; list: { x: number; y: number; echo: number }[] } = { tick: -1, list: [] };
  private echoClusters(world: World): { x: number; y: number; echo: number }[] {
    if (world.tick - this.clusterCache.tick < 20 && this.clusterCache.tick >= 0) return this.clusterCache.list;
    const m = world.map;
    const list: { x: number; y: number; echo: number }[] = [];
    const step = 4;
    for (let ty = step; ty < m.height - step; ty += step)
      for (let tx = step; tx < m.width - step; tx += step) {
        let echo = 0;
        for (let y = ty - 3; y <= ty + 3; y++) for (let x = tx - 3; x <= tx + 3; x++) echo += m.echo[y * m.width + x]!;
        if (echo >= 120) list.push({ x: (tx << FX_SHIFT) + FX_HALF, y: (ty << FX_SHIFT) + FX_HALF, echo });
      }
    this.clusterCache = { tick: world.tick, list };
    return list;
  }

  /** A field no refinery of ours serves (none within 10 tiles), that we can build beside from where we are. */
  private refineryField(world: World, own: Own): { x: number; y: number } | null {
    const e = world.entities;
    const refineries = own.byRole.get('refinery') ?? [];
    const rule = world.rules.structures[world.rules.factions[world.players[this.player]!.faction]!.structures.map((i) => world.rules.structures[i]!).find((r) => r.role === 'refinery')!.index]!;
    const faction = world.rules.factions[world.players[this.player]!.faction]!;
    const view = worldPlacementView(world, this.player);
    let best: { x: number; y: number } | null = null;
    let bestScore = -0x7fffffff;
    for (const c of this.echoClusters(world)) {
      if (refineries.some((r) => ilength(e.x[r]! - c.x, e.y[r]! - c.y) < 10 * FX_ONE)) continue;

      // Reachable: some spot within 5 tiles of the field passes our placement rules.
      const cx = c.x >> FX_SHIFT;
      const cy = c.y >> FX_SHIFT;
      let ok = false;
      for (let dy = -5; dy <= 5 && !ok; dy++)
        for (let dx = -5; dx <= 5 && !ok; dx++) if (placementError(view, this.player, faction, rule, cx + dx, cy + dy) === null) ok = true;
      if (!ok) continue;
      const home = ilength((this.home.x << FX_SHIFT) - c.x, (this.home.y << FX_SHIFT) - c.y) >> FX_SHIFT;
      const score = c.echo - home * 6;
      if (score > bestScore) {
        bestScore = score;
        best = { x: c.x, y: c.y };
      }
    }
    return best;
  }

  /** Richest Echo cluster away from our structures and from enemies we know about, nearest home first. */
  private expansionSite(world: World, own: Own): { x: number; y: number } | null {
    const field = this.expansionField(world, own);
    if (!field) return null;
    // Deploy beside the field, never on it: the nearest spot (toward home) where the yard fits.
    const p = world.players[this.player]!;
    const cv = world.rules.units[world.rules.factions[p.faction]!.constructionUnit]!;
    const ability = cv.abilities.find((a) => a.kind === 'deploy');
    const yardRule = ability && ability.kind === 'deploy' ? world.rules.structures[world.rules.structureIndex.get(ability.into)!]! : null;
    if (!yardRule) return null;
    const view = worldPlacementView(world, this.player);
    const fx = field.x >> FX_SHIFT;
    const fy = field.y >> FX_SHIFT;
    let best: { x: number; y: number } | null = null;
    let bestD = 0x7fffffff;
    for (let dy = -9; dy <= 9; dy++)
      for (let dx = -9; dx <= 9; dx++) {
        const r2 = dx * dx + dy * dy;
        if (r2 < 9 || r2 > 81) continue;
        const tx = fx + dx - (yardRule.footprintW >> 1);
        const ty = fy + dy - (yardRule.footprintH >> 1);
        if (footprintBlocked(view, yardRule, tx, ty)) continue;
        const d = r2 * 4 + ilength(this.home.x - (fx + dx), this.home.y - (fy + dy));
        if (d < bestD) {
          bestD = d;
          best = { x: ((fx + dx) << FX_SHIFT) + FX_HALF, y: ((fy + dy) << FX_SHIFT) + FX_HALF };
        }
      }
    return best;
  }

  private expansionField(world: World, own: Own): { x: number; y: number } | null {
    const m = world.map;
    const e = world.entities;
    let best: { x: number; y: number } | null = null;
    let bestScore = -0x7fffffff;
    const step = 4;
    for (let ty = step; ty < m.height - step; ty += step) {
      for (let tx = step; tx < m.width - step; tx += step) {
        let echo = 0;
        for (let y = ty - 3; y <= ty + 3; y++) for (let x = tx - 3; x <= tx + 3; x++) echo += m.echo[y * m.width + x]!;
        if (echo < 120) continue;
        const px = (tx << FX_SHIFT) + FX_HALF;
        const py = (ty << FX_SHIFT) + FX_HALF;
        // Already ours: a structure within 10 tiles.
        if (own.structures.some((s) => ilength(e.x[s]! - px, e.y[s]! - py) < 10 * FX_ONE)) continue;
        // Hostile: a known enemy structure within 14 tiles.
        let hostile = false;
        for (const mem of this.memory.values()) if (mem.structure && ilength(mem.x - px, mem.y - py) < 14 * FX_ONE) hostile = true;
        if (hostile) continue;
        const home = ilength((this.home.x << FX_SHIFT) - px, (this.home.y << FX_SHIFT) - py) >> FX_SHIFT;
        const score = echo - home * 6;
        if (score > bestScore) {
          bestScore = score;
          best = { x: px, y: py };
        }
      }
    }
    return best;
  }

  private survey(world: World): Own {
    const e = world.entities;
    const faction = world.rules.factions[world.players[this.player]!.faction]!;
    const own: Own = { structures: [], byRole: new Map(), units: [], army: [], harvesters: [], constructionUnits: [], conyards: [] };
    for (let s = 0; s < e.high; s++) {
      if (e.alive[s] !== 1 || e.owner[s] !== this.player) continue;
      if (e.kind[s] === KIND.structure) {
        own.structures.push(s);
        const role = world.rules.structures[e.type[s]!]!.role;
        let list = own.byRole.get(role);
        if (!list) {
          list = [];
          own.byRole.set(role, list);
        }
        list.push(s);
        if (role === 'conyard') own.conyards.push(s);
      } else if (e.kind[s] === KIND.unit) {
        own.units.push(s);
        const rule = world.rules.units[e.type[s]!]!;
        if (rule.index === faction.constructionUnit) own.constructionUnits.push(s);
        else if (rule.abilities.some((a) => a.kind === 'harvest')) own.harvesters.push(s);
        else if (rule.weapon) own.army.push(s);
      }
    }
    // Forget assignments of dead units.
    for (const h of this.waveUnits) if (e.resolve(h) < 0) this.waveUnits.delete(h);
    for (const h of this.raiders) if (e.resolve(h) < 0) this.raiders.delete(h);
    return own;
  }

  private count(own: Own, role: Role): number {
    return own.byRole.get(role)?.length ?? 0;
  }

  // --- tech ---

  /** Research upgrades at the tech center when money allows (Normal and up). Faction upgrades first. */
  private research(world: World, own: Own): void {
    if (this.difficulty === 'easy' || this.count(own, 'tech') === 0) return;
    const p = world.players[this.player]!;
    if (p.research.item >= 0 || p.credits < RESEARCH_RESERVE) return;
    const facts = computeFacts(world)[this.player]!;
    const ups = world.rules.upgrades;
    const order = this.directed
      ? (this.plan.research ?? []).map((id) => ups.find((u) => u.id === id)!).filter((u) => u)
      : [...ups.filter((u) => u.faction === p.faction), ...ups.filter((u) => u.faction < 0)].sort((a, b) => a.tier - b.tier);
    // Doctrines (either/or): tech and turtle plans take the pricier, longer-term one, the rest the cheaper.
    const longGame = this.strategy.name === 'tech' || this.strategy.name === 'turtle';
    const skip = (u: (typeof ups)[number]) => {
      if (!u.excludes || this.directed) return false;
      const other = ups.find((x) => x.id === u.excludes)!;
      return longGame ? u.cost < other.cost : u.cost > other.cost;
    };
    for (const u of order) {
      if (skip(u) || !canResearch(world, facts, this.player, u.index)) continue;
      this.act({ type: 'research', upgrade: u.index });
      return;
    }
  }

  private abilities(world: World, own: Own): void {
    // Easy and Normal leave abilities and support powers alone, like a player who doesn't micro.
    if (!this.d.abilities && !this.directed) return;
    for (const cmd of abilityOrders(world, this.player, this.home, own.army)) if (!this.act(cmd)) return;
    const power = powerOrder(world, this.player, own.army);
    if (power) this.act(power);
    const strike = superweaponOrder(world, this.player);
    if (strike) this.act(strike);
  }

  // --- economy ---

  private deploy(world: World, own: Own): void {
    if (own.conyards.length > 0) return;
    if (own.constructionUnits.length === 0) {
      // Comeback: no yard and no construction unit, but a refinery can build one (same rule as players).
      const p = world.players[this.player]!;
      const cu = world.rules.factions[p.faction]!.constructionUnit;
      if (this.count(own, 'refinery') > 0 && !p.production[1]!.items.includes(cu)) this.act({ type: 'train', item: cu, count: 1 });
      return;
    }
    // (Later construction vehicles are expanders, see expand().)
    const s = own.constructionUnits[0]!;
    this.act({ type: 'deploy', units: [world.entities.handle(s)] });
  }

  /**
   * No harvesters and not enough money for one: cancel builds for the refund,
   * then sell defenses until a harvester is affordable. Returns true while recovering.
   */
  private recover(world: World, own: Own): boolean {
    if (own.harvesters.length > 0 || this.count(own, 'refinery') === 0) return false;
    const p = world.players[this.player]!;
    const faction = world.rules.factions[p.faction]!;
    const harvester = world.rules.units[faction.harvester]!;
    const vq = p.production[1]!;
    if (vq.items.includes(harvester.index)) {
      // Already buying one: clear everything else so the money goes to it.
      if (p.build[0]!.item >= 0 && !p.build[0]!.ready) this.act({ type: 'cancelBuild', category: 'structures' });
      if (p.build[1]!.item >= 0 && !p.build[1]!.ready) this.act({ type: 'cancelBuild', category: 'defenses' });
      for (const item of vq.items) if (item !== harvester.index) this.act({ type: 'cancelTrain', item });
      return true;
    }
    if (p.credits >= harvester.cost || p.credits + p.build[0]!.spent + p.build[1]!.spent >= harvester.cost) {
      this.act({ type: 'train', item: harvester.index, count: 1 });
      return true;
    }
    const e = world.entities;
    const sellable = own.structures.filter((s) => world.rules.structures[e.type[s]!]!.category === 'defenses');
    if (sellable.length > 0) this.act({ type: 'sell', target: e.handle(sellable[0]!) });
    return true;
  }

  private placeReady(world: World, own: Own): void {
    const p = world.players[this.player]!;
    p.build.forEach((q, cat) => {
      if (q.item < 0 || !q.ready) return;
      const rule = world.rules.structures[q.item]!;
      const spot = this.findSpot(world, own, rule);
      if (spot) this.act({ type: 'place', category: cat === 0 ? 'structures' : 'defenses', tx: spot.tx, ty: spot.ty });
      else this.act({ type: 'cancelBuild', category: cat === 0 ? 'structures' : 'defenses' });
    });
  }

  /** Next structure to build: power headroom first, then the opening, then refineries, later tech and defenses. */
  private nextStructure(world: World, own: Own): Role | null {
    const p = world.players[this.player]!;
    // Keep headroom for the next building (most use 20-60).
    if (p.powerProduced - p.powerUsed < 40 && this.count(own, 'conyard') > 0) return 'power';
    const seen = new Map<Role, number>();
    if (this.directed) {
      for (const id of this.plan.build ?? []) {
        const role = world.rules.structures[world.rules.structureIndex.get(id)!]!.role;
        seen.set(role, (seen.get(role) ?? 0) + 1);
        if (this.count(own, role) < seen.get(role)!) return role;
      }
      // Then whatever the wanted army still needs (a plan asking for tanks gets the buildings for tanks).
      const faction = world.rules.factions[p.faction]!;
      const have = (role: Role) => this.count(own, role) > 0;
      for (const [id, weight] of this.plan.army ?? []) {
        if (weight <= 0) continue;
        for (const role of world.rules.units[world.rules.unitIndex.get(id)!]!.requires) {
          if (have(role)) continue;
          const rule = faction.structures.map((i) => world.rules.structures[i]!).find((r) => r.role === role && r.category);
          if (rule && rule.requires.every(have)) return role;
        }
      }
      if (this.plan.build) return null;
    }
    for (const role of this.profile.opening) {
      seen.set(role, (seen.get(role) ?? 0) + 1);
      // Easy and Normal open with one refinery for a while.
      if (role === 'refinery' && seen.get(role)! > 1 && world.tick < this.d.secondRefineryTick) continue;
      if (this.count(own, role) < seen.get(role)!) return role;
    }
    const refineries = this.count(own, 'refinery');
    // One refinery per Echo field: the first at home, more only beside a field no refinery of ours serves
    // (another refinery at the same field gains nothing: unloading is quick, more harvesters are cheaper).
    const capAll = Math.min(this.profile.maxRefineries, this.d.maxRefineries);
    if (refineries === 0) return 'refinery';
    if (refineries < capAll && world.tick > refineries * 2 * MINUTE && p.credits < 3000 && this.refineryField(world, own)) return 'refinery';
    // Tech is a luxury: only with spare money or once the game has gone long.
    if (this.d.retreat && p.credits < 1500 && world.tick < 8 * MINUTE) return null;
    for (const role of this.profile.later) {
      // Only AIs that use powers build a superweapon (Easy and Normal would leave it idle), and only
      // once the match has gone long or money piles up: early on the credits belong in the army.
      if (role === 'superweapon' && (world.noSuperweapons || world.techLimit || (!this.d.abilities && !this.directed) || (world.tick < SUPERWEAPON_AFTER && p.credits < 2 * FLOAT_CREDITS))) continue;
      if (this.count(own, role) === 0) return role;
    }
    // Money piling up means production is the bottleneck: another barracks or factory
    // (extra ones speed up their tab), alternating, up to a few of each.
    if (this.d.extraProduction && p.credits >= FLOAT_CREDITS) {
      const barracks = this.count(own, 'barracks');
      const factories = this.count(own, 'factory');
      if (factories <= barracks && factories < MAX_PRODUCTION) return 'factory';
      if (barracks < MAX_PRODUCTION) return 'barracks';
    }
    return null;
  }

  /** Own units of one type, alive or queued. */
  private countUnits(world: World, own: Own, type: number, p: World['players'][number]): number {
    let n = 0;
    for (const u of own.units) if (world.entities.type[u] === type) n++;
    for (const q of p.production) for (const i of q.items) if (i === type) n++;
    return n;
  }

  private nextDefense(world: World, own: Own): Role | null {
    const wanted =
      this.directed && this.plan.defenses
        ? this.plan.defenses.map((id) => world.rules.structures[world.rules.structureIndex.get(id)!]!.role)
        : this.profile.defenses.slice(0, this.d.defenses);
    const seen = new Map<Role, number>();
    for (const role of wanted) {
      seen.set(role, (seen.get(role) ?? 0) + 1);
      if (this.count(own, role) < seen.get(role)!) return role;
    }
    return null;
  }

  private construct(world: World, own: Own): void {
    if (world.tick < this.nextBuildTick || own.conyards.length === 0) return;
    const p = world.players[this.player]!;
    const faction = world.rules.factions[p.faction]!;
    const roleRule = (role: Role) => faction.structures.map((i) => world.rules.structures[i]!).find((r) => r.role === role)!;
    const roles = new Set<Role>(own.byRole.keys());
    const can = (r: StructureRule) => r.requires.every((x) => roles.has(x));
    // Low power stalls everything: swap a pending non-power build for a power plant.
    const q = p.build[0]!;
    if (p.lowPower && q.item >= 0 && !q.ready && world.rules.structures[q.item]!.role !== 'power') {
      this.act({ type: 'cancelBuild', category: 'structures' });
      return;
    }
    if (p.build[0]!.item < 0) {
      const role = this.nextStructure(world, own);
      const rule = role ? roleRule(role) : null;
      if (rule && can(rule) && this.act({ type: 'build', category: 'structures', item: rule.index })) this.nextBuildTick = world.tick + this.d.buildDelayTicks;
    }
    if (p.build[1]!.item < 0 && world.tick > 3 * MINUTE) {
      const role = this.nextDefense(world, own);
      const rule = role ? roleRule(role) : null;
      if (rule && can(rule) && p.credits > rule.cost) this.act({ type: 'build', category: 'defenses', item: rule.index });
    }
  }

  // --- base planning ---

  /** Pick a spot: refineries near Echo, defenses toward the enemy, everything else around the yard with a gap. */
  private findSpot(world: World, own: Own, rule: StructureRule): { tx: number; ty: number } | null {
    const e = world.entities;
    // Refineries go up at the newest yard (an expansion); everything else stays at home.
    const yard = (rule.role === 'refinery' ? own.conyards[own.conyards.length - 1] : own.conyards[0]) ?? own.structures[0];
    if (yard === undefined) return null;
    const faction = world.rules.factions[world.players[this.player]!.faction]!;
    const view = worldPlacementView(world, this.player);
    let ax = e.x[yard]! >> FX_SHIFT;
    let ay = e.y[yard]! >> FX_SHIFT;
    if (rule.role === 'refinery') {
      // Beside a field we do not serve yet (the home field for the first one).
      const field = this.count(own, 'refinery') === 0 ? null : this.refineryField(world, own);
      if (field) {
        ax = field.x >> FX_SHIFT;
        ay = field.y >> FX_SHIFT;
      } else {
        const echo = nearestEcho(world, ax, ay, 20);
        if (echo >= 0) {
          // Halfway between the yard and the field keeps it in build range.
          ax = idiv(ax + (echo % world.map.width), 2);
          ay = idiv(ay + idiv(echo, world.map.width), 2);
        }
      }
    }
    // Direction to the enemy, so layouts are the same relative to the front for every start.
    const enemy = this.enemyStarts[0]!;
    const ex = enemy.x - ax;
    const ey = enemy.y - ay;
    const elen = Math.max(1, ilength(ex, ey));
    if (rule.category === 'defenses') {
      ax += idiv(ex * 7, elen);
      ay += idiv(ey * 7, elen);
    } else if (rule.role !== 'refinery') {
      // Grow the base backwards, away from the enemy.
      ax -= idiv(ex * 3, elen);
      ay -= idiv(ey * 3, elen);
    }
    let best: { tx: number; ty: number } | null = null;
    let bestD = 0x7fffffff;
    for (let r = 0; r <= 16 && !best; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const tx = ax + dx - (rule.footprintW >> 1);
          const ty = ay + dy - (rule.footprintH >> 1);
          if (placementError(view, this.player, faction, rule, tx, ty) !== null) continue;
          if (rule.role !== 'wall' && crowded(view, rule, tx, ty)) continue;
          // Ties (same ring) go to the spot farthest from the enemy: symmetric for mirrored starts.
          const d = (dx * dx + dy * dy) * 4096 + dx * ex + dy * ey;
          if (d < bestD) {
            bestD = d;
            best = { tx, ty };
          }
        }
      }
    }
    return best;
  }

  // --- production ---

  private produce(world: World, own: Own): void {
    const p = world.players[this.player]!;
    const faction = world.rules.factions[p.faction]!;
    const roles = new Set<Role>(own.byRole.keys());
    const ok = (u: UnitRule) => u.requires.every((r) => roles.has(r));

    // Harvesters first.
    // Easy under-harvests, Hard over-harvests; Normal follows the faction profile.
    const perRefinery =
      this.directed && this.plan.harvestersPerRefinery !== undefined
        ? this.plan.harvestersPerRefinery
        : this.difficulty === 'easy'
          ? 1
          : this.difficulty === 'normal'
            ? this.profile.harvestersPerRefinery
            : this.d.maxHarvestersPerRefinery;
    const refineries = this.count(own, 'refinery');
    const wantHarvesters = Math.min(MAX_HARVESTERS, refineries * perRefinery);
    const harvester = world.rules.units[faction.harvester]!;
    const vq = p.production[1]!;
    const queuedHarvesters = vq.items.filter((i) => i === harvester.index).length;
    const shortOnHarvesters = own.harvesters.length + queuedHarvesters < wantHarvesters && ok(harvester);
    if (shortOnHarvesters && queuedHarvesters === 0) this.act({ type: 'train', item: harvester.index, count: 1 });
    // Economy first only for the basics: every refinery needs one harvester, and power must be on.
    if ((own.harvesters.length < refineries && ok(harvester)) || p.lowPower) return;

    // Scouts/raiders are part of the army list; army fills each tab's queue up to two.
    const mix = this.directed && this.plan.army ? this.plan.army : this.profile.army;
    const candidates = mix
      .map(([id, weight]) => ({ rule: world.rules.units[world.rules.unitIndex.get(id)!]!, weight }))
      .filter((c) => c.weight > 0)
      .filter((c) => ok(c.rule))
      // Match option: nothing of tier 3.
      .filter((c) => !world.techLimit || c.rule.tier < 3)
      // Support units (no weapon: repair trucks, engineers) back an army, two of each is plenty.
      .filter((c) => c.rule.weapon !== null || this.countUnits(world, own, c.rule.index, p) < SUPPORT_CAP);
    if (candidates.length === 0) return;
    for (const tab of ['infantry', 'vehicles', 'air'] as const) {
      const q = p.production[tab === 'infantry' ? 0 : tab === 'vehicles' ? 1 : 2]!;
      if (q.items.length >= this.d.queueDepth) continue;
      const pool = candidates.filter((c) => c.rule.tab === tab);
      if (pool.length === 0) continue;
      const pick = this.choose(world, pool);
      if (!pick || p.credits < this.d.armyReserve) continue;
      if (p.credits >= pick.cost || q.items.length === 0) this.act({ type: 'train', item: pick.index, count: 1 });
    }
  }

  /** Weighted pick; with counters on, weights grow with effectiveness against what we've seen. */
  private choose(world: World, pool: { rule: UnitRule; weight: number }[]): UnitRule | null {
    const armorValue = new Array<number>(ARMOR.length).fill(0);
    let total = 0;
    let air = 0;
    // Value-weighted shield share of the enemy army: shields change how well each damage type works.
    let shielded = 0;
    for (const m of this.known(world)) {
      if (m.structure || !m.armed) continue;
      if (m.armor === AIR_ARMOR) air += m.cost;
      if (this.directed ? this.plan.adapt !== true : !this.d.counter) continue;
      armorValue[m.armor]! += m.cost;
      total += m.cost;
      shielded += m.cost * m.shieldShare;
    }
    const shieldShare = total > 0 ? idiv(shielded, total) : 0;
    const weights = pool.map((c) => {
      // Anti-air only once enemy aircraft have shown up.
      if (c.rule.weapon && !c.rule.weapon.targetsGround && air === 0) return 0;
      if (total === 0 || !c.rule.weapon) return c.weight * 100;
      // Average matrix percent against the enemy army, by value.
      let eff = 0;
      for (let a = 0; a < ARMOR.length; a++) {
        const canHit = a === 3 ? c.rule.weapon.targetsAir : c.rule.weapon.targetsGround;
        if (canHit) eff += armorValue[a]! * world.rules.damageMatrix[c.rule.weapon.type * ARMOR.length + a]!;
      }
      const vsShields = world.rules.constants.shieldDamagePct[c.rule.weapon.type]!;
      eff = idiv(eff * (100 - shieldShare + idiv(shieldShare * vsShields, 100)), 100);
      return Math.max(1, idiv(c.weight * idiv(eff, total) * idiv(eff, total), 100));
    });
    let sum = 0;
    for (const w of weights) sum += w;
    if (sum === 0) return null;
    let r = world.aiRng[this.player]!.int(sum);
    for (let i = 0; i < pool.length; i++) {
      r -= weights[i]!;
      if (r < 0) return pool[i]!.rule;
    }
    return pool[0]!.rule;
  }

  // --- tactics ---

  /** Staging point in front of the base, toward the enemy. */
  private stagingPoint(world: World, own: Own): { x: number; y: number } {
    if (this.directed && this.plan.rally) return { x: (this.plan.rally[0] << FX_SHIFT) + FX_HALF, y: (this.plan.rally[1] << FX_SHIFT) + FX_HALF };
    const e = world.entities;
    const yard = own.conyards[0] ?? own.structures[0];
    const bx = yard !== undefined ? e.x[yard]! : (this.home.x << FX_SHIFT) + FX_HALF;
    const by = yard !== undefined ? e.y[yard]! : (this.home.y << FX_SHIFT) + FX_HALF;
    const enemy = this.enemyStarts[0]!;
    const dx = (enemy.x << FX_SHIFT) - bx;
    const dy = (enemy.y << FX_SHIFT) - by;
    const len = Math.max(1, ilength(dx, dy));
    return { x: bx + idiv(dx * 12, len) * FX_ONE, y: by + idiv(dy * 12, len) * FX_ONE };
  }

  private rally(world: World, own: Own): void {
    const e = world.entities;
    const stage = this.stagingPoint(world, own);
    // A new rally point re-rallies every factory.
    if (this.directed && (this.lastRally.x !== stage.x || this.lastRally.y !== stage.y)) {
      this.ralliedFactories.clear();
      this.lastRally = stage;
    }
    for (const s of own.structures) {
      const rule = world.rules.structures[e.type[s]!]!;
      if (!rule.produces || this.ralliedFactories.has(e.handle(s))) continue;
      if (this.act({ type: 'rally', target: e.handle(s), x: stage.x, y: stage.y })) this.ralliedFactories.add(e.handle(s));
    }
  }

  /** Units not busy with a wave, scouting or raiding. */
  private reserve(world: World, own: Own): number[] {
    const e = world.entities;
    return own.army.map((s) => e.handle(s)).filter((h) => !this.waveUnits.has(h) && !this.raiders.has(h) && !this.holders.has(h) && h !== this.scoutHandle);
  }

  private defend(world: World, own: Own): void {
    // An agent decides whether to defend (it sees the attack in its observation).
    if (this.directed) return;
    const e = world.entities;
    let threatX = -1;
    let threatY = 0;
    // Structures and harvesters both count: losing harvesters loses the game.
    for (const s of [...own.structures, ...own.harvesters]) {
      if (e.lastHitTick[s]! < 0 || world.tick - e.lastHitTick[s]! > UNDER_ATTACK_TICKS) continue;
      if (world.tick - e.lastHitTick[s]! < this.d.reactionTicks && this.d.reactionTicks > UNDER_ATTACK_TICKS) continue;
      threatX = e.x[s]!;
      threatY = e.y[s]!;
      break;
    }
    if (threatX < 0) return;
    if (this.d.retreat && this.attacking && this.knownEnemyArmyNear(world, threatX, threatY) > this.armyValue(world, this.reserve(world, own))) {
      // The base needs the wave more than the attack does.
      this.waveUnits.clear();
      this.attacking = false;
      this.nextWaveTick = world.tick + MINUTE;
    }
    const defenders = this.reserve(world, own);
    // Recall the wave too if the base is in trouble and it hasn't got far.
    if (defenders.length === 0) return;
    if ((world.tick + this.player) % 40 !== 0) return;
    this.act({ type: 'attackMove', units: defenders, x: threatX, y: threatY });
  }

  private scout(world: World, own: Own): void {
    if (!(this.directed ? (this.plan.scout ?? true) : this.d.scout) || world.tick < MINUTE || world.tick - this.scoutSentTick < 4 * MINUTE) return;
    const e = world.entities;
    const scoutRule = world.rules.unitIndex.get(this.profile.scout);
    const s = own.army.find((u) => e.type[u] === scoutRule && !this.waveUnits.has(e.handle(u)) && !this.raiders.has(e.handle(u)));
    if (s === undefined) return;
    const target = this.enemyStarts[world.aiRng[this.player]!.int(this.enemyStarts.length)]!;
    if (this.act({ type: 'move', units: [e.handle(s)], x: (target.x << FX_SHIFT) + FX_HALF, y: (target.y << FX_SHIFT) + FX_HALF })) {
      this.scoutHandle = e.handle(s);
      this.scoutSentTick = world.tick;
    }
  }

  private harass(world: World, own: Own): void {
    if (!(this.directed ? (this.plan.harass ?? false) : this.d.harass) || world.tick < 3 * MINUTE || (world.tick + this.player) % 200 !== 0) return;
    const e = world.entities;
    const raiderRule = world.rules.unitIndex.get(this.profile.raider);
    for (const s of own.army) {
      if (this.raiders.size >= 2) break;
      const h = e.handle(s);
      if (e.type[s] === raiderRule && !this.waveUnits.has(h) && h !== this.scoutHandle) this.raiders.add(h);
    }
    if (this.raiders.size === 0) return;
    // Hit the most recently seen enemy harvester, else the enemy's nearest Echo.
    let target: { x: number; y: number } | null = null;
    let latest = -1;
    for (const m of this.known(world)) {
      if (!m.harvester || m.lastSeen <= latest) continue;
      latest = m.lastSeen;
      target = { x: m.x, y: m.y };
    }
    if (!target) {
      const start = this.enemyStarts[0]!;
      const echo = nearestEcho(world, start.x, start.y, 24);
      if (echo < 0) return;
      target = { x: ((echo % world.map.width) << FX_SHIFT) + FX_HALF, y: (idiv(echo, world.map.width) << FX_SHIFT) + FX_HALF };
    }
    this.act({ type: 'attackMove', units: [...this.raiders], x: target.x, y: target.y });
  }

  /**
   * Capture points: from minute 4, the three fastest spare army units go to the nearest point on our half
   * of the map that our team does not hold, take it, then rejoin the army.
   */
  private capturePoints(world: World, own: Own): void {
    if (world.points.length === 0 || world.tick < 4 * MINUTE || (world.tick + this.player) % 100 !== 0) return;
    const e = world.entities;
    for (const h of this.holders) if (e.resolve(h) < 0) this.holders.delete(h);
    const team = world.players[this.player]!.team;
    // King of the hill: a bigger squad goes for the hill and stays on it (holding is what scores).
    const hill = world.points.findIndex((p) => p.kind === POINT.hill);
    if (hill >= 0) {
      const want = this.difficulty === 'easy' ? 2 : this.difficulty === 'normal' ? 4 : 6;
      for (const h of this.reserve(world, own)) {
        if (this.holders.size >= want) break;
        this.holders.add(h);
      }
      const p = world.points[hill]!;
      if (this.holders.size > 0) this.act({ type: 'attackMove', units: [...this.holders], x: (p.x << FX_SHIFT) + FX_HALF, y: (p.y << FX_SHIFT) + FX_HALF });
      return;
    }
    const homeX = (this.home.x << FX_SHIFT) + FX_HALF;
    const homeY = (this.home.y << FX_SHIFT) + FX_HALF;
    let best = -1;
    let bestD = 0;
    world.points.forEach((p, i) => {
      if (p.owner >= 0 && world.players[p.owner]!.team === team) return;
      const d = ilength((p.x << FX_SHIFT) - homeX, (p.y << FX_SHIFT) - homeY);
      // Only points on our side of the map: no squad marches into the enemy's half for one.
      const enemy = this.enemyStarts.reduce((m, s) => Math.min(m, ilength((p.x - s.x) << FX_SHIFT, (p.y - s.y) << FX_SHIFT)), Infinity);
      if (enemy < d) return;
      if (best < 0 || d < bestD) {
        best = i;
        bestD = d;
      }
    });
    // Taken (or nothing left to take): the squad goes back to the army.
    if (this.holdTarget >= 0) {
      const t = world.points[this.holdTarget]!;
      if (t.owner >= 0 && world.players[t.owner]!.team === team) {
        this.holders.clear();
        this.holdTarget = -1;
      }
    }
    if (best < 0) {
      this.holders.clear();
      return;
    }
    this.holdTarget = best;
    const want = this.difficulty === 'easy' ? 1 : 3;
    // Fast units first: a point goes to whoever gets there and stays.
    const speed = (h: number) => world.rules.units[e.type[e.resolve(h)]!]!.speed;
    for (const h of this.reserve(world, own).sort((a, b) => speed(b) - speed(a) || a - b)) {
      if (this.holders.size >= want) break;
      this.holders.add(h);
    }
    if (this.holders.size === 0) return;
    const p = world.points[best]!;
    this.act({ type: 'attackMove', units: [...this.holders], x: (p.x << FX_SHIFT) + FX_HALF, y: (p.y << FX_SHIFT) + FX_HALF });
  }

  /** Crates in sight: the nearest spare army unit within 15 tiles goes to pick each one up. */
  private pickCrates(world: World, own: Own): void {
    if (!world.crates || world.crates.list.length === 0 || (world.tick + this.player) % 60 !== 0) return;
    const e = world.entities;
    const fog = world.fog[this.player]!;
    const spare = this.reserve(world, own);
    for (const c of world.crates.list) {
      if ((fog[c.y * world.map.width + c.x]! & FOG_VISIBLE) === 0) continue;
      const cx = (c.x << FX_SHIFT) + FX_HALF;
      const cy = (c.y << FX_SHIFT) + FX_HALF;
      let best = -1;
      let bestD = 15 * FX_ONE;
      for (const h of spare) {
        const s = e.resolve(h);
        const d = ilength(e.x[s]! - cx, e.y[s]! - cy);
        if (d < bestD) {
          best = h;
          bestD = d;
        }
      }
      if (best >= 0) this.act({ type: 'move', units: [best], x: cx, y: cy });
    }
  }

  private armyValue(world: World, handles: Iterable<number>): number {
    const e = world.entities;
    let v = 0;
    for (const h of handles) {
      const s = e.resolve(h);
      if (s >= 0) v += pct(world.rules.units[e.type[s]!]!.cost, idiv(e.hp[s]! * 100, Math.max(1, e.maxHp[s]!)));
    }
    return v;
  }

  /** Value of enemy combat units seen recently near (x, y). */
  private knownEnemyArmyNear(world: World, x: number, y: number): number {
    let v = 0;
    for (const m of this.memory.values()) {
      if (m.structure || !m.armed || world.tick - m.lastSeen > 100) continue;
      if (ilength(m.x - x, m.y - y) <= 12 * FX_ONE) v += m.cost;
    }
    return v;
  }

  /** Value of enemy combat units seen in the last two minutes. */
  private knownEnemyArmy(world: World): number {
    let v = 0;
    for (const m of this.known(world)) if (!m.structure && m.armed && world.tick - m.lastSeen < 2 * MINUTE) v += m.cost;
    return v;
  }

  /** Attack target: the nearest remembered enemy structure, else an enemy start. */
  private attackTarget(world: World, own: Own): { x: number; y: number } {
    if (this.directed && this.plan.target) return { x: (this.plan.target[0] << FX_SHIFT) + FX_HALF, y: (this.plan.target[1] << FX_SHIFT) + FX_HALF };
    // King of the hill: while the hill isn't ours, that's where the fight is.
    const hill = world.points.find((p) => p.kind === POINT.hill);
    if (hill && (hill.owner < 0 || world.players[hill.owner]!.team !== world.players[this.player]!.team))
      return { x: (hill.x << FX_SHIFT) + FX_HALF, y: (hill.y << FX_SHIFT) + FX_HALF };
    const stage = this.stagingPoint(world, own);
    let best: Sighting | null = null;
    let bestD = 0x7fffffff;
    for (const m of this.memory.values()) {
      if (!m.structure) continue;
      const d = ilength((m.x - stage.x) >> FX_SHIFT, (m.y - stage.y) >> FX_SHIFT);
      if (d < bestD) {
        bestD = d;
        best = m;
      }
    }
    if (best) return { x: best.x, y: best.y };
    // No buildings known: their start first, until we have seen it.
    const fog = world.fog[this.player]!;
    for (const st of this.enemyStarts) if ((fog[st.y * world.map.width + st.x]! & 2) === 0) return { x: (st.x << FX_SHIFT) + FX_HALF, y: (st.y << FX_SHIFT) + FX_HALF };
    // Then any enemy seen lately (stragglers, a lone construction vehicle).
    let unit: Sighting | null = null;
    for (const m of this.memory.values()) if (!m.structure && (!unit || m.lastSeen > unit.lastSeen)) unit = m;
    if (unit) return { x: unit.x, y: unit.y };
    // Nothing known at all: sweep the map, enemy starts first, then a grid of points.
    const sweep = [...this.enemyStarts, ...SWEEP.map(([u, v]) => ({ x: idiv(world.map.width * u, 8), y: idiv(world.map.height * v, 8) }))];
    const spot = sweep[idiv(world.tick, 600) % sweep.length]!;
    return { x: (spot.x << FX_SHIFT) + FX_HALF, y: (spot.y << FX_SHIFT) + FX_HALF };
  }

  private waves(world: World, own: Own): void {
    const e = world.entities;
    if (this.attacking) {
      const value = this.armyValue(world, this.waveUnits);
      if (this.waveUnits.size === 0) {
        this.attacking = false;
        this.nextWaveTick = world.tick + MINUTE;
        return;
      }
      // Retreat from a lost fight (Hard+; an agent decides that itself).
      if (this.d.retreat && !this.directed && value * 100 < this.waveStartValue * 35) {
        const stage = this.stagingPoint(world, own);
        if (this.act({ type: 'move', units: [...this.waveUnits], x: stage.x, y: stage.y })) {
          this.waveUnits.clear();
          this.attacking = false;
          this.nextWaveTick = world.tick + MINUTE;
        }
        return;
      }
      // Re-target every few seconds: idle wave units push on.
      if ((world.tick + this.player) % 100 === 0) {
        const idle = [...this.waveUnits].filter((h) => {
          const s = e.resolve(h);
          return s >= 0 && e.orders[s]!.length === 0;
        });
        if (idle.length > 0) {
          const t = this.attackTarget(world, own);
          this.act({ type: 'attackMove', units: idle, x: t.x, y: t.y });
        }
      }
      if (this.d.focusFire && !this.directed && (world.tick + this.player) % 30 === 0) this.focusFire(world);
      return;
    }
    const reserve = this.reserve(world, own);
    const value = this.armyValue(world, reserve);
    if (this.directed) {
      // The agent decides when to fight: defend never attacks, attack waits for the threshold, all-in goes now.
      const posture = this.plan.posture ?? 'defend';
      if (posture === 'defend' || reserve.length === 0) return;
      if (posture === 'attack' && (world.tick < this.nextWaveTick || value < (this.plan.attackAt ?? this.d.firstWave))) return;
    } else {
      if (world.tick < this.nextWaveTick) return;
      if (value < this.d.firstWave + this.waveIndex * this.d.waveGrowth) return;
      // Smarter AIs only attack with a clear edge over the enemy army they know about.
      if (this.d.retreat && value * 10 < this.peakEnemyArmy * ADVANTAGE_X10) return;
    }
    const t = this.attackTarget(world, own);
    const wave = reserve;
    if (!this.act({ type: 'attackMove', units: wave, x: t.x, y: t.y })) return;
    for (const h of wave) this.waveUnits.add(h);
    this.waveStartValue = value;
    this.attacking = true;
    this.waveIndex++;
  }

  /**
   * Focus fire: wave units already close to a fight gang up on the weakest
   * visible enemy within 4 tiles of them; units farther away keep attack-moving.
   */
  private focusFire(world: World): void {
    const e = world.entities;
    for (const [h, m] of this.memory) {
      if (m.structure || !m.armed || m.lastSeen !== world.tick) continue;
      const t = e.resolve(h);
      if (t < 0 || e.hp[t]! + e.shields[t]! > idiv(e.maxHp[t]! + e.maxShields[t]!, 2)) continue;
      const near: number[] = [];
      for (const u of this.waveUnits) {
        const s = e.resolve(u);
        if (s >= 0 && ilength(e.x[s]! - m.x, e.y[s]! - m.y) <= 4 * FX_ONE) near.push(u);
      }
      if (near.length >= 2 && this.act({ type: 'attack', units: near, target: h })) return;
    }
  }
}

/** Points (eighths of the map) a hunting wave sweeps when it knows no enemy. */
const SWEEP: [number, number][] = [
  [4, 4], [2, 2], [6, 2], [6, 6], [2, 6], [4, 1], [7, 4], [4, 7], [1, 4],
];

/** Nearest tile with Echo within `radius` of (tx, ty) (map knowledge is shared in the lobby). */
function nearestEcho(world: World, tx: number, ty: number, radius: number): number {
  const m = world.map;
  let best = -1;
  let bestD = 0x7fffffff;
  for (let y = Math.max(0, ty - radius); y <= Math.min(m.height - 1, ty + radius); y++) {
    for (let x = Math.max(0, tx - radius); x <= Math.min(m.width - 1, tx + radius); x++) {
      const i = y * m.width + x;
      if (m.echo[i] === 0) continue;
      const d = (x - tx) * (x - tx) + (y - ty) * (y - ty);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
  }
  return best;
}

/** Keep a one-tile gap around structures so the base never walls itself in. */
function crowded(view: PlacementView, rule: StructureRule, tx: number, ty: number): boolean {
  for (const s of view.structures) {
    if (s.rule.role === 'wall') continue;
    if (tx - 1 < s.tx + s.rule.footprintW && s.tx < tx + rule.footprintW + 1 && ty - 1 < s.ty + s.rule.footprintH && s.ty < ty + rule.footprintH + 1) return true;
  }
  return false;
}

/**
 * Ability use for a set of units: phase out or blink away when badly hurt,
 * blink in to close the gap on a target, dig in when holding and enemies close in, Override the most valuable enemy
 * machine in reach. Pure function of the world, so the battle lab can reuse it.
 */
export function abilityOrders(world: World, player: number, home: { x: number; y: number }, units: number[]): Command[] {
  const e = world.entities;
  const out: Command[] = [];
  for (const s of units) {
    if (e.alive[s] !== 1 || world.tick < e.abilityReady[s]!) continue;
    const rule = world.rules.units[e.type[s]!]!;
    const ability = rule.abilities.find((a) => a.kind === 'blink' || a.kind === 'phase' || a.kind === 'override' || a.kind === 'digIn' || a.kind === 'uplink');
    if (!ability) continue;
    const h = e.handle(s);
    if (ability.kind === 'uplink') {
      // Fighting outside the network: bring it along (one uplink per area is enough).
      if (e.target[s]! < 0 || inCoverage(world, s) || e.uplinkUntil[s]! > world.tick) continue;
      let near = false;
      for (const o of units) if (o !== s && e.uplinkUntil[o]! > world.tick && ilength(e.x[o]! - e.x[s]!, e.y[o]! - e.y[s]!) <= ability.radius) near = true;
      if (!near) out.push({ type: 'ability', units: [h] });
      continue;
    }
    if (ability.kind === 'digIn') {
      // Holding a position (no orders) with enemies closing in: dig in. Any new order packs up.
      if (e.dugInAt[s]! > 0 || e.orders[s]!.length > 0 || !rule.weapon) continue;
      let threat = false;
      const team = teamOf(world, s);
      const reach = rule.weapon.range + 3 * FX_ONE;
      world.spatial.query(e.x[s]!, e.y[s]!, reach, (n) => {
        if (threat || e.kind[n] !== KIND.unit || teamOf(world, n) === team || !visibleTo(world, player, n)) return;
        if (ilength(e.x[n]! - e.x[s]!, e.y[n]! - e.y[s]!) <= reach) threat = true;
      });
      if (threat) out.push({ type: 'ability', units: [h] });
      continue;
    }
    const life = e.hp[s]! + e.shields[s]!;
    const max = e.maxHp[s]! + e.maxShields[s]!;
    const hurt = life * 100 < max * 40 && e.lastHitTick[s]! >= 0 && world.tick - e.lastHitTick[s]! < 20;
    // Escapes when badly hurt are autocast by the sim for everyone (players too).
    if (ability.kind === 'phase') continue;
    if (ability.kind === 'blink') {
      if (hurt) continue;
      const t = e.resolve(e.target[s]!);
      if (t >= 0 && rule.weapon && ilength(e.x[t]! - e.x[s]!, e.y[t]! - e.y[s]!) > rule.weapon.range + 2 * FX_ONE)
        out.push({ type: 'ability', units: [h], x: e.x[t]!, y: e.y[t]! });
      continue;
    }
    // Override: the most expensive visible enemy vehicle or aircraft within range.
    let best = -1;
    let bestCost = 0;
    const team = teamOf(world, s);
    world.spatial.query(e.x[s]!, e.y[s]!, ability.range, (n) => {
      if (e.kind[n] !== KIND.unit || teamOf(world, n) === team || e.homeOwner[n]! >= 0) return;
      const victim = world.rules.units[e.type[n]!]!;
      if (victim.tab === 'infantry' || !victim.weapon) return;
      if (!visibleTo(world, player, n) || ilength(e.x[n]! - e.x[s]!, e.y[n]! - e.y[s]!) > ability.range) return;
      if (victim.cost > bestCost || (victim.cost === bestCost && n < best)) {
        best = n;
        bestCost = victim.cost;
      }
    });
    if (best >= 0 && bestCost >= OVERRIDE_MIN_COST) out.push({ type: 'ability', units: [h], target: e.handle(best) });
  }
  return out;
}

/** Fewest enemies worth a support power. */
const POWER_MIN_TARGETS = 4;

/**
 * Support power for an AI player: Jam the densest visible enemy group its army is fighting.
 * Same rules as players (cooldown, building, visibility). Returns the command or null.
 */
export function powerOrder(world: World, player: number, army: number[]): Command | null {
  if ((world.tick + player) % 20 !== 0 || !powerReady(world, player)) return null;
  const power = world.rules.factions[world.players[player]!.faction]!.power;
  if (!power) return null;
  const e = world.entities;
  const team = world.players[player]!.team;
  if (power.kind === 'awaken') {
    // Awaken an Echo field where enemies are: fighting our army there, or harvesting it.
    const m = world.map;
    const echoNear = (x: number, y: number) => {
      const r = power.reach >> FX_SHIFT;
      for (let ty = (y >> FX_SHIFT) - r; ty <= (y >> FX_SHIFT) + r; ty++)
        for (let tx = (x >> FX_SHIFT) - r; tx <= (x >> FX_SHIFT) + r; tx++)
          if (tx >= 0 && ty >= 0 && tx < m.width && ty < m.height && m.echo[ty * m.width + tx]! > 0) return true;
      return false;
    };
    let pick: { x: number; y: number; n: number } | null = null;
    const consider = (x: number, y: number, n: number) => {
      if (n >= 1 && (!pick || n > pick.n) && echoNear(x, y) && nearOwnStructure(world, player, x, y, AWAKEN_HOME_RANGE)) pick = { x, y, n };
    };
    for (let o = 0; o < e.high; o++) {
      if (e.alive[o] !== 1 || e.kind[o] !== KIND.unit || teamOf(world, o) === team || !visibleTo(world, player, o)) continue;
      const harvester = world.rules.units[e.type[o]!]!.abilities.some((a) => a.kind === 'harvest');
      if (harvester) consider(e.x[o]!, e.y[o]!, 2);
    }
    for (const s of army) {
      const t = e.resolve(e.target[s]!);
      if (t >= 0 && visibleTo(world, player, t)) consider(e.x[t]!, e.y[t]!, 3);
    }
    const best = pick as { x: number; y: number; n: number } | null;
    return best ? { type: 'power', x: best.x, y: best.y } : null;
  }
  let best: { x: number; y: number; n: number } | null = null;
  for (const s of army) {
    const t = e.resolve(e.target[s]!);
    if (t < 0 || !visibleTo(world, player, t)) continue;
    let n = 0;
    world.spatial.query(e.x[t]!, e.y[t]!, power.radius, (o) => {
      if (e.kind[o] !== KIND.unit || teamOf(world, o) === team || !visibleTo(world, player, o)) return;
      if (world.rules.factions[world.players[e.owner[o]!]!.faction]!.airGapped) return;
      if (ilength(e.x[o]! - e.x[t]!, e.y[o]! - e.y[t]!) <= power.radius) n++;
    });
    if (n >= POWER_MIN_TARGETS && (!best || n > best.n)) best = { x: e.x[t]!, y: e.y[t]!, n };
  }
  return best ? { type: 'power', x: best.x, y: best.y } : null;
}

/** The AI builds its superweapon from this tick on (sooner with money piling up). */
const SUPERWEAPON_AFTER = 14 * MINUTE;

/** Least value (credits) under the blast worth a superweapon strike. */
const STRIKE_MIN_VALUE = 2000;

/**
 * Superweapon for an AI player: once charged, strike the visible spot with the most enemy value
 * under the blast (structures count double: they can't dodge). Same rules as players.
 */
export function superweaponOrder(world: World, player: number): Command | null {
  if ((world.tick + player) % 20 !== 0 || superweaponStatus(world, player) !== 0) return null;
  const f = world.rules.factions[world.players[player]!.faction]!;
  const sw = f.structures.map((i) => world.rules.structures[i]!.superweapon).find((x) => x !== null);
  if (!sw) return null;
  const e = world.entities;
  const team = world.players[player]!.team;
  let best: { x: number; y: number; v: number } | null = null;
  for (let c = 0; c < e.high; c++) {
    if (e.alive[c] !== 1 || e.kind[c] !== KIND.structure || teamOf(world, c) === team || !visibleTo(world, player, c)) continue;
    let v = 0;
    world.spatial.query(e.x[c]!, e.y[c]!, sw.radius, (o) => {
      if (e.alive[o] !== 1 || (e.kind[o] !== KIND.unit && e.kind[o] !== KIND.structure) || !visibleTo(world, player, o)) return;
      if (ilength(e.x[o]! - e.x[c]!, e.y[o]! - e.y[c]!) > sw.radius) return;
      const worth = costOf(world, o) * (e.kind[o] === KIND.structure ? 2 : 1);
      v += teamOf(world, o) === team ? 0 : worth;
    });
    if (v >= STRIKE_MIN_VALUE && (!best || v > best.v)) best = { x: e.x[c]!, y: e.y[c]!, v };
  }
  return best ? { type: 'superweapon', x: best.x, y: best.y } : null;
}
