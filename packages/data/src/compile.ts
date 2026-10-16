import {
  ARMOR,
  DAMAGE,
  FACTIONS,
  type AbilityDef,
  type Constants,
  type DamageMatrix,
  type FactionDef,
  type FactionId,
  type Keymap,
  type Role,
  type StructureDef,
  type Tab,
  type UnitDef,
  type UpgradeDef,
  type UpgradeEffect,
  type WeaponDef,
} from './schema';

// Compiled rules: every number is an integer in sim units.
//   distances  -> Q10 fixed point (1024 = one tile)
//   durations  -> ticks
//   speeds     -> Q10 per tick
// Float math is allowed here (never in the sim): JSON parsing, multiplication by
// a power of two, IEEE division and Math.round are exact and identical in every
// JS engine, so the compiled integers are the same everywhere.

export const FX_SHIFT = 10;
export const FX_ONE = 1 << FX_SHIFT;

export type ArmorIdx = number;
export type DamageIdx = number;
export type FactionIdx = number;

export interface WeaponRule {
  damage: number;
  type: DamageIdx;
  range: number;
  minRange: number;
  cooldown: number;
  targetsGround: boolean;
  targetsAir: boolean;
  splash: number;
  projectileSpeed: number;
}

export type AbilityRule =
  | { kind: 'harvest'; capacity: number }
  | { kind: 'engineer'; capture: boolean; repair: boolean; salvage: boolean; restoreShields: boolean }
  | { kind: 'repairAura'; radius: number; hpPerSecond: number }
  | { kind: 'deploy'; into: string }
  | { kind: 'blink'; range: number; cooldown: number }
  | { kind: 'phase'; duration: number; cooldown: number }
  | { kind: 'override'; range: number; duration: number; cooldown: number }
  | { kind: 'chain'; jumps: number; falloffPct: number }
  | { kind: 'sweep'; width: number }
  | { kind: 'digIn'; setup: number; damageTakenPct: number; rangeBonus: number }
  | { kind: 'uplink'; radius: number; duration: number; cooldown: number };

/** Compiled support power (radii Q10, times in ticks; Awaken's unit as a rule index). */
export type SupportPowerRule =
  | { kind: 'jam'; name: string; requires: Role; radius: number; duration: number; cooldown: number; fireRatePct: number }
  | { kind: 'awaken'; name: string; requires: Role; unit: number; count: number; duration: number; cooldown: number; echoCost: number; reach: number };

export interface UnitRule {
  kind: 'unit';
  index: number;
  id: string;
  name: string;
  faction: FactionIdx;
  key: string;
  tab: Tab;
  tier: number;
  armor: ArmorIdx;
  isAir: boolean;
  cost: number;
  buildTicks: number;
  hp: number;
  shields: number;
  speed: number;
  sight: number;
  radius: number;
  weapon: WeaponRule | null;
  abilities: AbilityRule[];
  requires: Role[];
  /** One-line role description for the UI. */
  role: string;
  /** Summoned by a power, never trained. */
  summoned: boolean;
  /** Unit id whose art draws this unit. */
  sprite: string;
}

export interface StructureRule {
  kind: 'structure';
  index: number;
  id: string;
  name: string;
  faction: FactionIdx;
  role: Role;
  description: string;
  key: string | null;
  category: 'structures' | 'defenses' | null;
  tier: number;
  cost: number;
  buildTicks: number;
  hp: number;
  power: number;
  footprintW: number;
  footprintH: number;
  sight: number;
  weapon: WeaponRule | null;
  requires: Role[];
  produces: Tab | null;
  blocksGround: boolean;
  coverageRadius: number;
  growthRadius: number;
  repairRadius: number;
  echoRegrowPct: number;
}

export interface UpgradeRule {
  index: number;
  id: string;
  name: string;
  faction: FactionIdx | -1;
  tier: number;
  cost: number;
  researchTicks: number;
  requires: Role[];
  requiresUpgrade: string | null;
  effect: UpgradeEffect;
}

export interface FactionRule {
  index: FactionIdx;
  id: FactionId;
  name: string;
  monospaceNames: boolean;
  palette: FactionDef['palette'];
  constructionUnit: number;
  harvester: number;
  engineer: number;
  placement: 'adjacent' | 'coverage' | 'growth';
  adjacencyRange: number;
  airGapped: boolean;
  salvagePct: number;
  coverageFireRatePct: number;
  coverageRegenHpPerSecond: number;
  recompileRefundPct: number;
  overrideResistPct: number;
  shieldRegenDelay: number;
  shieldRegenPerSecond: number;
  chorusPct: number;
  chorusMax: number;
  chorusRadius: number;
  /** Support power, if the faction has one. */
  power: SupportPowerRule | null;
  structures: number[];
  units: number[];
}

export interface ConstantsRule {
  tickRate: number;
  startCredits: number;
  unitCap: number;
  echoValuePerCrystal: number;
  echoCellCap: number;
  echoRegrowTicks: number;
  lowPowerSpeedPct: number;
  sellRefundPct: number;
  repairCostPct: number;
  repairHpPctPerSecond: number;
  extraFactoryBonusPct: number[];
  veterancyThresholdPct: number[];
  veterancyDamagePct: number;
  veterancyHpPct: number;
  wreckLifetimeTicks: number;
  upgradeLevels: number;
  /** Percent damage to shields, indexed by damage type. */
  shieldDamagePct: number[];
}

export interface Rules {
  constants: ConstantsRule;
  /** damageMatrix[damageIdx * ARMOR.length + armorIdx] = percent */
  damageMatrix: number[];
  factions: FactionRule[];
  units: UnitRule[];
  structures: StructureRule[];
  upgrades: UpgradeRule[];
  unitIndex: ReadonlyMap<string, number>;
  structureIndex: ReadonlyMap<string, number>;
  upgradeIndex: ReadonlyMap<string, number>;
  keymap: Keymap;
}

export interface RawData {
  factions: FactionDef[];
  upgrades: UpgradeDef[];
  damageMatrix: DamageMatrix;
  constants: Constants;
  keymap: Keymap;
}

export const armorIndex = (a: (typeof ARMOR)[number]): ArmorIdx => ARMOR.indexOf(a);
export const damageIndex = (d: (typeof DAMAGE)[number]): DamageIdx => DAMAGE.indexOf(d);
export const factionIndex = (f: FactionId): FactionIdx => FACTIONS.indexOf(f);

export function compileRules(raw: RawData): Rules {
  const tickRate = raw.constants.tickRate;
  const fx = (tiles: number): number => Math.round(tiles * FX_ONE);
  const ticks = (seconds: number): number => Math.max(1, Math.round(seconds * tickRate));
  const perTick = (tilesPerSecond: number): number => Math.max(1, Math.round((tilesPerSecond * FX_ONE) / tickRate));

  const weapon = (w: WeaponDef | undefined): WeaponRule | null =>
    w
      ? {
          damage: w.damage,
          type: damageIndex(w.type),
          range: fx(w.range),
          minRange: fx(w.minRange),
          cooldown: ticks(w.cooldown),
          targetsGround: w.targets !== 'air',
          targetsAir: w.targets !== 'ground',
          splash: fx(w.splash),
          projectileSpeed: w.projectileSpeed > 0 ? perTick(w.projectileSpeed) : 0,
        }
      : null;

  const ability = (a: AbilityDef): AbilityRule => {
    switch (a.kind) {
      case 'harvest':
      case 'engineer':
      case 'deploy':
        return a;
      case 'repairAura':
        return { kind: 'repairAura', radius: fx(a.radius), hpPerSecond: a.hpPerSecond };
      case 'blink':
        return { kind: 'blink', range: fx(a.range), cooldown: ticks(a.cooldown) };
      case 'phase':
        return { kind: 'phase', duration: ticks(a.duration), cooldown: ticks(a.cooldown) };
      case 'override':
        return { kind: 'override', range: fx(a.range), duration: ticks(a.duration), cooldown: ticks(a.cooldown) };
      case 'chain':
        return a;
      case 'sweep':
        return { kind: 'sweep', width: fx(a.width) };
      case 'digIn':
        return { kind: 'digIn', setup: ticks(a.setup), damageTakenPct: a.damageTakenPct, rangeBonus: fx(a.rangeBonus) };
      case 'uplink':
        return { kind: 'uplink', radius: fx(a.radius), duration: ticks(a.duration), cooldown: ticks(a.cooldown) };
    }
  };

  const units: UnitRule[] = [];
  const structures: StructureRule[] = [];
  const unitIndex = new Map<string, number>();
  const structureIndex = new Map<string, number>();

  // Factions are compiled in the canonical FACTIONS order regardless of input order.
  const factionDefs = FACTIONS.map((fid) => {
    const def = raw.factions.find((f) => f.id === fid);
    if (!def) throw new Error(`missing faction ${fid}`);
    return def;
  });

  for (const f of factionDefs) {
    const fi = factionIndex(f.id);
    for (const s of f.structures) {
      const rule = compileStructure(s, fi, structures.length, fx, ticks, weapon, raw.constants.structureHpPct);
      structureIndex.set(s.id, rule.index);
      structures.push(rule);
    }
    for (const u of f.units) {
      const rule = compileUnit(u, fi, units.length, fx, ticks, perTick, weapon, ability);
      unitIndex.set(u.id, rule.index);
      units.push(rule);
    }
  }

  const unitRef = (uid: string): number => {
    const i = unitIndex.get(uid);
    if (i === undefined) throw new Error(`unknown unit ${uid}`);
    return i;
  };

  const factions: FactionRule[] = factionDefs.map((f) => {
    const fi = factionIndex(f.id);
    const m = f.mechanics;
    return {
      index: fi,
      id: f.id,
      name: f.name,
      monospaceNames: f.monospaceNames,
      palette: f.palette,
      constructionUnit: unitRef(f.constructionUnit),
      harvester: unitRef(f.harvester),
      engineer: unitRef(f.engineer),
      placement: m.placement,
      adjacencyRange: m.adjacencyRange,
      airGapped: m.airGapped,
      salvagePct: m.salvagePct,
      coverageFireRatePct: m.coverageFireRatePct,
      coverageRegenHpPerSecond: m.coverageRegenHpPerSecond,
      recompileRefundPct: m.recompileRefundPct,
      overrideResistPct: m.overrideResistPct,
      shieldRegenDelay: m.shieldRegenDelay > 0 ? ticks(m.shieldRegenDelay) : 0,
      shieldRegenPerSecond: m.shieldRegenPerSecond,
      chorusPct: m.chorusPct,
      chorusMax: m.chorusMax,
      chorusRadius: fx(m.chorusRadius),
      power: !f.power
        ? null
        : f.power.kind === 'jam'
          ? { ...f.power, radius: fx(f.power.radius), duration: ticks(f.power.duration), cooldown: ticks(f.power.cooldown) }
          : { ...f.power, unit: unitRef(f.power.unit), duration: ticks(f.power.duration), cooldown: ticks(f.power.cooldown), reach: fx(f.power.reach) },
      structures: structures.filter((s) => s.faction === fi).map((s) => s.index),
      units: units.filter((u) => u.faction === fi && !u.summoned).map((u) => u.index),
    };
  });

  const upgradeIndex = new Map<string, number>();
  const upgrades: UpgradeRule[] = raw.upgrades.map((u, index) => {
    upgradeIndex.set(u.id, index);
    return {
      index,
      id: u.id,
      name: u.name,
      faction: u.faction === 'all' ? -1 : factionIndex(u.faction),
      tier: u.tier,
      cost: u.cost,
      researchTicks: ticks(u.researchTime),
      requires: u.requires,
      requiresUpgrade: u.requiresUpgrade ?? null,
      effect: u.effect,
    };
  });

  const damageMatrix: number[] = [];
  for (const d of DAMAGE) for (const a of ARMOR) damageMatrix.push(raw.damageMatrix[d][a]);

  const c = raw.constants;
  const constants: ConstantsRule = {
    tickRate,
    startCredits: c.startCredits,
    unitCap: c.unitCap,
    echoValuePerCrystal: c.echoValuePerCrystal,
    echoCellCap: c.echoCellCap,
    echoRegrowTicks: ticks(c.echoRegrowSeconds),
    lowPowerSpeedPct: c.lowPowerSpeedPct,
    sellRefundPct: c.sellRefundPct,
    repairCostPct: c.repairCostPct,
    repairHpPctPerSecond: c.repairHpPctPerSecond,
    extraFactoryBonusPct: c.extraFactoryBonusPct,
    veterancyThresholdPct: c.veterancyThresholdPct,
    veterancyDamagePct: c.veterancyDamagePct,
    veterancyHpPct: c.veterancyHpPct,
    wreckLifetimeTicks: ticks(c.wreckLifetime),
    upgradeLevels: c.upgradeLevels,
    shieldDamagePct: DAMAGE.map((d) => c.shieldDamagePct[d] ?? 100),
  };

  return {
    constants,
    damageMatrix,
    factions,
    units,
    structures,
    upgrades,
    unitIndex,
    structureIndex,
    upgradeIndex,
    keymap: raw.keymap,
  };
}

function compileStructure(
  s: StructureDef,
  faction: FactionIdx,
  index: number,
  fx: (n: number) => number,
  ticks: (n: number) => number,
  weapon: (w: WeaponDef | undefined) => WeaponRule | null,
  hpPct: number,
): StructureRule {
  return {
    kind: 'structure',
    index,
    id: s.id,
    name: s.name,
    faction,
    role: s.role,
    description: s.description,
    key: s.key ?? null,
    category: s.category ?? null,
    tier: s.tier,
    cost: s.cost,
    buildTicks: ticks(s.buildTime),
    hp: Math.round((s.hp * hpPct) / 100),
    power: s.power,
    footprintW: s.footprint[0],
    footprintH: s.footprint[1],
    sight: fx(s.sight),
    weapon: weapon(s.weapon),
    requires: s.requires,
    produces: s.produces ?? null,
    blocksGround: s.blocksGround,
    coverageRadius: fx(s.coverageRadius),
    growthRadius: fx(s.growthRadius),
    repairRadius: fx(s.repairRadius),
    echoRegrowPct: s.echoRegrowPct,
  };
}

function compileUnit(
  u: UnitDef,
  faction: FactionIdx,
  index: number,
  fx: (n: number) => number,
  ticks: (n: number) => number,
  perTick: (n: number) => number,
  weapon: (w: WeaponDef | undefined) => WeaponRule | null,
  ability: (a: AbilityDef) => AbilityRule,
): UnitRule {
  return {
    kind: 'unit',
    index,
    id: u.id,
    name: u.name,
    faction,
    key: u.key,
    tab: u.tab,
    tier: u.tier,
    armor: armorIndex(u.armor),
    isAir: u.armor === 'air',
    cost: u.cost,
    buildTicks: ticks(u.buildTime),
    hp: u.hp,
    shields: u.shields,
    speed: perTick(u.speed),
    sight: fx(u.sight),
    radius: fx(u.radius),
    weapon: weapon(u.weapon),
    abilities: u.abilities.map(ability),
    requires: u.requires,
    role: u.role,
    summoned: u.summoned,
    sprite: u.sprite ?? u.id,
  };
}
