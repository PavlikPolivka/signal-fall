import { z } from 'zod';

// Raw data schemas. JSON files use human units (tiles, seconds, tiles/s) and
// may contain decimals; compile.ts converts everything to the integer units
// the deterministic sim works in.

export const FACTIONS = ['holdout', 'halcyon', 'choir'] as const;
export const UNIT_ARMOR = ['light', 'medium', 'heavy', 'air'] as const;
export const ARMOR = [...UNIT_ARMOR, 'structure'] as const;
export const DAMAGE = ['kinetic', 'explosive', 'energy', 'flak', 'siege'] as const;
export const TABS = ['infantry', 'vehicles', 'air'] as const;
export const BUILD_CATEGORIES = ['structures', 'defenses'] as const;
export const ROLES = [
  'conyard',
  'power',
  'refinery',
  'barracks',
  'factory',
  'radar',
  'special',
  'airfield',
  'tech',
  'defense',
  'antiAir',
  'heavyDefense',
  'wall',
] as const;

export type FactionId = (typeof FACTIONS)[number];
export type Armor = (typeof ARMOR)[number];
export type UnitArmor = (typeof UNIT_ARMOR)[number];
export type DamageType = (typeof DAMAGE)[number];
export type Tab = (typeof TABS)[number];
export type BuildCategory = (typeof BUILD_CATEGORIES)[number];
export type Role = (typeof ROLES)[number];

const id = z.string().regex(/^[a-z][a-z0-9_]*$/);
const hotkey = z.string().regex(/^[A-Z]$/);
const pct = z.number().int().min(0).max(1000);
const color = z.string().regex(/^#[0-9a-f]{6}$/);

export const weaponSchema = z
  .object({
    damage: z.number().int().positive(),
    type: z.enum(DAMAGE),
    range: z.number().positive(),
    minRange: z.number().nonnegative().default(0),
    cooldown: z.number().positive(),
    targets: z.enum(['ground', 'air', 'both']),
    splash: z.number().nonnegative().default(0),
    projectileSpeed: z.number().nonnegative().default(0),
  })
  .strict();

export const abilitySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('harvest'), capacity: z.number().int().positive() }).strict(),
  z
    .object({
      kind: z.literal('engineer'),
      capture: z.boolean(),
      repair: z.boolean(),
      salvage: z.boolean().default(false),
      restoreShields: z.boolean().default(false),
    })
    .strict(),
  z
    .object({
      kind: z.literal('repairAura'),
      radius: z.number().positive(),
      hpPerSecond: z.number().int().positive(),
    })
    .strict(),
  z.object({ kind: z.literal('deploy'), into: id }).strict(),
  z
    .object({ kind: z.literal('blink'), range: z.number().positive(), cooldown: z.number().positive() })
    .strict(),
  z
    .object({ kind: z.literal('phase'), duration: z.number().positive(), cooldown: z.number().positive() })
    .strict(),
  z
    .object({
      kind: z.literal('override'),
      range: z.number().positive(),
      duration: z.number().positive(),
      cooldown: z.number().positive(),
    })
    .strict(),
  z.object({ kind: z.literal('chain'), jumps: z.number().int().positive(), falloffPct: pct }).strict(),
  z.object({ kind: z.literal('sweep'), width: z.number().positive() }).strict(),
  // Uplink: the unit projects network coverage around itself for a while.
  z
    .object({ kind: z.literal('uplink'), radius: z.number().positive(), duration: z.number().positive(), cooldown: z.number().positive() })
    .strict(),
  // Entrench: can't move; takes less damage and outranges a little once dug in. Moving packs up.
  z
    .object({ kind: z.literal('digIn'), setup: z.number().positive(), damageTakenPct: pct, rangeBonus: z.number().nonnegative() })
    .strict(),
]);

export const unitSchema = z
  .object({
    id,
    name: z.string().min(1),
    key: hotkey,
    tab: z.enum(TABS),
    tier: z.number().int().min(1).max(3),
    armor: z.enum(UNIT_ARMOR),
    cost: z.number().int().positive(),
    buildTime: z.number().positive(),
    hp: z.number().int().positive(),
    shields: z.number().int().nonnegative().default(0),
    speed: z.number().positive(),
    sight: z.number().positive(),
    radius: z.number().positive(),
    weapon: weaponSchema.optional(),
    abilities: z.array(abilitySchema).default([]),
    requires: z.array(z.enum(ROLES)).default([]),
    role: z.string().min(1),
    /** Summoned by a power, never trained: not in the build menus or the roster. */
    summoned: z.boolean().default(false),
    /** Draw with another unit's art (summoned units have none of their own). */
    sprite: id.optional(),
  })
  .strict();

export const structureSchema = z
  .object({
    id,
    name: z.string().min(1),
    role: z.enum(ROLES),
    description: z.string().default(''),
    key: hotkey.optional(),
    category: z.enum(BUILD_CATEGORIES).optional(),
    tier: z.number().int().min(1).max(3),
    cost: z.number().int().nonnegative(),
    buildTime: z.number().positive(),
    hp: z.number().int().positive(),
    power: z.number().int(),
    footprint: z.tuple([z.number().int().positive(), z.number().int().positive()]),
    sight: z.number().positive(),
    weapon: weaponSchema.optional(),
    requires: z.array(z.enum(ROLES)).default([]),
    produces: z.enum(TABS).optional(),
    blocksGround: z.boolean().default(true),
    coverageRadius: z.number().nonnegative().default(0),
    growthRadius: z.number().nonnegative().default(0),
    repairRadius: z.number().nonnegative().default(0),
    echoRegrowPct: pct.default(0),
  })
  .strict();

export const upgradeEffectSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('damagePct'), pct }).strict(),
  z.object({ kind: z.literal('hpPct'), pct }).strict(),
  z.object({ kind: z.literal('salvagePct'), pct }).strict(),
  z.object({ kind: z.literal('vehicleEnergyResistPct'), pct }).strict(),
  z.object({ kind: z.literal('coverageRadiusPct'), pct }).strict(),
  z.object({ kind: z.literal('recompileRefundPct'), pct }).strict(),
  z.object({ kind: z.literal('shieldPct'), pct }).strict(),
  z.object({ kind: z.literal('growSpeedPct'), pct }).strict(),
]);

export const upgradeSchema = z
  .object({
    id,
    name: z.string().min(1),
    faction: z.union([z.enum(FACTIONS), z.literal('all')]),
    tier: z.number().int().min(2).max(3),
    cost: z.number().int().positive(),
    researchTime: z.number().positive(),
    requires: z.array(z.enum(ROLES)).default([]),
    requiresUpgrade: id.optional(),
    effect: upgradeEffectSchema,
  })
  .strict();

export const factionMechanicsSchema = z
  .object({
    placement: z.enum(['adjacent', 'coverage', 'growth']),
    adjacencyRange: z.number().nonnegative().default(0),
    airGapped: z.boolean().default(false),
    salvagePct: pct.default(0),
    coverageFireRatePct: pct.default(0),
    coverageRegenHpPerSecond: z.number().int().nonnegative().default(0),
    recompileRefundPct: pct.default(0),
    overrideResistPct: pct.default(0),
    shieldRegenDelay: z.number().nonnegative().default(0),
    shieldRegenPerSecond: z.number().int().nonnegative().default(0),
    /** Chorus: each own unit of this faction within chorusRadius tiles adds this much damage, up to chorusMax units. */
    chorusPct: pct.default(0),
    chorusMax: z.number().int().nonnegative().default(0),
    chorusRadius: z.number().nonnegative().default(0),
  })
  .strict();

/** A faction's support power: cast at a map point from a building, on a player-wide cooldown. */
export const supportPowerSchema = z.discriminatedUnion('kind', [
  // Jam: enemy weapons in the area fire this much slower for a while (air-gapped factions are immune).
  z
    .object({
      kind: z.literal('jam'),
      name: z.string(),
      requires: z.enum(ROLES),
      radius: z.number().positive(),
      duration: z.number().positive(),
      cooldown: z.number().positive(),
      fireRatePct: pct,
    })
    .strict(),
  // Awaken: crystals of an Echo field rise as guardians that fight for a while.
  z
    .object({
      kind: z.literal('awaken'),
      name: z.string(),
      requires: z.enum(ROLES),
      unit: id,
      count: z.number().int().positive(),
      duration: z.number().positive(),
      cooldown: z.number().positive(),
      echoCost: z.number().int().nonnegative(),
      reach: z.number().positive(),
    })
    .strict(),
]);

export const factionSchema = z
  .object({
    id: z.enum(FACTIONS),
    name: z.string().min(1),
    monospaceNames: z.boolean().default(false),
    palette: z.object({ primary: color, secondary: color, accent: color }).strict(),
    constructionUnit: id,
    harvester: id,
    engineer: id,
    mechanics: factionMechanicsSchema,
    power: supportPowerSchema.optional(),
    structures: z.array(structureSchema),
    units: z.array(unitSchema),
  })
  .strict();

const armorRow = z.object({
  light: pct,
  medium: pct,
  heavy: pct,
  air: pct,
  structure: pct,
});

export const damageMatrixSchema = z
  .object({
    kinetic: armorRow,
    explosive: armorRow,
    energy: armorRow,
    flak: armorRow,
    siege: armorRow,
  })
  .strict();

export const constantsSchema = z
  .object({
    tickRate: z.number().int().positive(),
    startCredits: z.number().int().nonnegative(),
    unitCap: z.number().int().positive(),
    echoValuePerCrystal: z.number().int().positive(),
    echoCellCap: z.number().int().positive(),
    echoRegrowSeconds: z.number().positive(),
    lowPowerSpeedPct: pct,
    /** Every structure's hit points, percent of its listed value (bases hold while help arrives). */
    structureHpPct: z.number().int().min(10).max(1000),
    sellRefundPct: pct,
    repairCostPct: pct,
    repairHpPctPerSecond: pct,
    extraFactoryBonusPct: z.array(pct),
    veterancyThresholdPct: z.array(pct).length(3),
    veterancyDamagePct: pct,
    veterancyHpPct: pct,
    wreckLifetime: z.number().positive(),
    upgradeLevels: z.number().int().positive(),
    /** Damage to shields by damage type, percent (default 100): energy disrupts resonance, bullets glance off. */
    shieldDamagePct: z.partialRecord(z.enum(DAMAGE), pct).default({}),
  })
  .strict();

// A chord is "Mod+Mod+Code" where Code is a KeyboardEvent.code value.
// "Digit#" stands for Digit0..Digit9.
const chord = z.string().regex(/^((Ctrl|Shift|Alt)\+)*([A-Z][A-Za-z0-9#]*|Mouse(Left|Right|Middle))$/);

export const keymapSchema = z
  .object({
    global: z.record(z.string(), z.array(chord).min(1)),
    units: z.record(z.string(), z.array(chord).min(1)),
    base: z.record(z.string(), z.array(chord).min(1)),
    modifiers: z
      .object({ queue: z.enum(['Shift', 'Ctrl', 'Alt']), queueFive: z.enum(['Shift', 'Ctrl', 'Alt']) })
      .strict(),
  })
  .strict();

export type WeaponDef = z.infer<typeof weaponSchema>;
export type AbilityDef = z.infer<typeof abilitySchema>;
export type UnitDef = z.infer<typeof unitSchema>;
export type StructureDef = z.infer<typeof structureSchema>;
export type UpgradeDef = z.infer<typeof upgradeSchema>;
export type UpgradeEffect = z.infer<typeof upgradeEffectSchema>;
export type FactionMechanics = z.infer<typeof factionMechanicsSchema>;
export type FactionDef = z.infer<typeof factionSchema>;
export type DamageMatrix = z.infer<typeof damageMatrixSchema>;
export type Constants = z.infer<typeof constantsSchema>;
export type Keymap = z.infer<typeof keymapSchema>;

/** Per-faction AI profile: opening build order and army composition (by weight). */
export const aiProfileSchema = z
  .object({
    faction: z.enum(FACTIONS),
    opening: z.array(z.enum(ROLES)).min(1),
    later: z.array(z.enum(ROLES)),
    defenses: z.array(z.enum(ROLES)),
    harvestersPerRefinery: z.number().int().min(1).max(4),
    maxRefineries: z.number().int().min(1).max(8),
    scout: id,
    raider: id,
    army: z.array(z.tuple([id, z.number().int().positive()])).min(1),
  })
  .strict();

export type AiProfile = z.infer<typeof aiProfileSchema>;
