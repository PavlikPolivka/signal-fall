import { ARMOR, DAMAGE, type Rules, type StructureRule, type UnitRule, type WeaponRule } from '@signal-fall/data';
import { TEAM_COLORS, type ClientState } from '../game/state';
import { Icon } from './Icon';
import { describeEffect, money, roleNames } from '../game/names';
import { P } from '../protocol';

const FX = 1024;
export const ARMOR_LABEL = ['Light', 'Medium', 'Heavy', 'Air', 'Structure'];
export const DAMAGE_LABEL = ['Kinetic', 'Explosive', 'Energy', 'Flak', 'Siege'];

const secs = (ticks: number, rate: number) => `${Math.round((ticks / rate) * 10) / 10}s`;
const tiles = (fx: number) => `${Math.round((fx / FX) * 10) / 10}`;

/** Armor classes this damage type does at least full damage to. */
export function strongVs(rules: Rules, type: number): string[] {
  return ARMOR.map((_, a) => a).filter((a) => rules.damageMatrix[type * ARMOR.length + a]! >= 100).map((a) => ARMOR_LABEL[a]!);
}

/** Damage types that hit this armor for at least full damage. */
export function weakTo(rules: Rules, armor: number): string[] {
  return DAMAGE.map((_, d) => d).filter((d) => rules.damageMatrix[d * ARMOR.length + armor]! >= 100).map((d) => DAMAGE_LABEL[d]!);
}

function WeaponRows({ rules, w }: { rules: Rules; w: WeaponRule }) {
  const rate = rules.constants.tickRate;
  const dps = Math.round((w.damage * rate) / w.cooldown);
  const targets = w.targetsGround && w.targetsAir ? 'ground + air' : w.targetsAir ? 'air only' : 'ground only';
  return (
    <>
      <dt>Weapon</dt>
      <dd>
        <span class={`dmg dmg-${w.type}`}>{DAMAGE_LABEL[w.type]}</span> {w.damage} dmg every {secs(w.cooldown, rate)} (~{dps}/s)
      </dd>
      <dt>Range</dt>
      <dd>
        {tiles(w.range)} tiles{w.minRange > 0 ? ` (min ${tiles(w.minRange)})` : ''} · {targets}
        {w.splash > 0 ? ' · splash' : ''}
      </dd>
      <dt>Strong vs</dt>
      <dd class="good">{strongVs(rules, w.type).join(', ') || '—'}</dd>
    </>
  );
}

/** Enemy units (other factions) that hit this armor hardest: what beats it. */
export function counters(rules: Rules, faction: number, armor: number, max = 3): UnitRule[] {
  const air = armor === 3;
  return rules.units
    .filter((u) => u.faction !== faction && u.weapon && (air ? u.weapon.targetsAir : u.weapon.targetsGround))
    .map((u) => [u, rules.damageMatrix[u.weapon!.type * ARMOR.length + armor]! * u.weapon!.damage * rules.constants.tickRate / u.weapon!.cooldown] as const)
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([u]) => u);
}

/** Rich hover card for a buildable structure or unit. */
export function ItemCard({ state, rule, blocked }: { state: ClientState; rule: StructureRule | UnitRule; blocked?: string }) {
  const rules = state.rules;
  const rate = rules.constants.tickRate;
  const faction = rules.factions[rule.faction]!;
  const missing = state.missing(rule.requires);
  const credits = state.cur?.credits(state.localPlayer) ?? 0;
  const produced = state.cur?.player(state.localPlayer, 2) ?? 0;
  const used = state.cur?.player(state.localPlayer, 3) ?? 0;
  return (
    <div class="card" data-testid="info-card">
      <div class="card-art">
        <Icon state={state} faction={faction.id} id={rule.id} color={TEAM_COLORS[state.localPlayer % TEAM_COLORS.length]!} />
      </div>
      <header>
        <b class={faction.monospaceNames ? 'mono' : ''}>{rule.name}</b>
        {rule.key && <kbd>{rule.key}</kbd>}
        <span class="tier">Tier {rule.tier}</span>
      </header>
      <p class="desc">{rule.kind === 'structure' ? rule.description : rule.role}</p>
      <dl>
        <dt>Cost</dt>
        <dd class={credits < rule.cost ? 'bad' : ''}>{money(rule.cost)}</dd>
        <dt>Build time</dt>
        <dd>{secs(rule.buildTicks, rate)}</dd>
        {rule.kind === 'structure' && (
          <>
            <dt>Power</dt>
            <dd class={rule.power > 0 ? 'good' : rule.power < 0 && used - rule.power > produced ? 'bad' : ''}>
              {rule.power > 0 ? `+${rule.power} produced` : rule.power < 0 ? `${-rule.power} used` : 'none'}
              {rule.power < 0 && used - rule.power > produced ? ' — would cause low power' : ''}
            </dd>
            <dt>Size</dt>
            <dd>
              {rule.footprintW}×{rule.footprintH} tiles
            </dd>
          </>
        )}
        <dt>HP</dt>
        <dd>
          {rule.hp}
          {rule.kind === 'unit' && rule.shields > 0 ? ` + ${rule.shields} shields` : ''}
        </dd>
        <dt>Armor</dt>
        <dd>
          {rule.kind === 'unit' ? ARMOR_LABEL[rule.armor] : 'Structure'} · weak to{' '}
          <span class="bad">{weakTo(rules, rule.kind === 'unit' ? rule.armor : 4).join(', ')}</span>
        </dd>
        {rule.kind === 'unit' && (
          <>
            <dt>Speed</dt>
            <dd>{Math.round(((rule.speed * rate) / FX) * 10) / 10} tiles/s</dd>
          </>
        )}
        {rule.weapon && <WeaponRows rules={rules} w={rule.weapon} />}
        {rule.kind === 'unit' && (
          <>
            <dt>Beaten by</dt>
            <dd class="bad">{counters(rules, rule.faction, rule.armor).map((u) => `${u.name} (${rules.factions[u.faction]!.name})`).join(', ')}</dd>
          </>
        )}
      </dl>
      {rule.kind === 'unit' && <UnitUpgrades state={state} rule={rule} />}
      {missing.length > 0 && <p class="req bad">Requires {roleNames(rules, rule.faction, missing)}</p>}
      {blocked && (
        <p class="req bad" data-testid="item-blocked">
          {blocked}
        </p>
      )}
      <p class="hint muted">
        {rule.kind === 'unit'
          ? 'Click: queue 1 · Shift+click: 5 · Ctrl+click: repeat · Right-click: cancel'
          : `Click: build, then click again to place${rule.category === 'defenses' ? ' · Shift+click the map: place and start the next' : ''} · Right-click: cancel`}
      </p>
    </div>
  );
}

/** Research that makes this unit stronger, ticked when done. */
function UnitUpgrades({ state, rule }: { state: ClientState; rule: UnitRule }) {
  const rules = state.rules;
  const done = state.cur?.player(state.localPlayer, 7) ?? 0;
  const lines: [string, boolean][] = [];
  rules.upgrades.forEach((u) => {
    if (u.faction !== rule.faction && u.faction !== -1) return;
    const e = u.effect;
    let what: string | null = null;
    if (e.kind === 'damagePct' && rule.weapon) what = `+${e.pct}% damage`;
    else if (e.kind === 'hpPct') what = `+${e.pct}% HP`;
    else if (e.kind === 'shieldPct' && rule.shields > 0) what = `+${e.pct}% shields`;
    else if (e.kind === 'vehicleEnergyResistPct' && rule.tab === 'vehicles') what = `-${e.pct}% energy damage taken`;
    if (what) lines.push([`${u.name}: ${what}`, (done & (1 << u.index)) !== 0]);
  });
  if (lines.length === 0) return null;
  return (
    <ul class="upgrades" data-testid="unit-upgrades">
      {lines.map(([text, has]) => (
        <li class={has ? 'good' : 'muted'}>
          {has ? '✓' : '○'} {text}
        </li>
      ))}
    </ul>
  );
}

/** Small card for an entity under the cursor in the world. */
/** Seen an enemy tech center: which doctrine they chose (doctrines are pairs, one per match). */
function EnemyDoctrine({ state, player }: { state: ClientState; player: number }) {
  const done = state.cur!.player(player, P.upgrades);
  const chosen = state.rules.upgrades.filter((u) => u.excludes && (done & (1 << u.index)) !== 0);
  return (
    <div class="muted" data-testid="enemy-doctrine">
      Doctrine: {chosen.length > 0 ? chosen.map((u) => `${u.name} (${describeEffect(u.effect.kind, u.effect.pct)})`).join(', ') : 'none chosen yet'}
    </div>
  );
}

export function EntityCard({ state, h }: { state: ClientState; h: number }) {
  const off = state.off(h);
  if (off < 0) return null;
  const rule = state.ruleOf(h);
  const cur = state.cur!;
  const owner = cur.get(off, 3);
  const kind = cur.get(off, 1);
  const own = owner === state.localPlayer;
  const hp = cur.get(off, 6);
  const maxHp = cur.get(off, 7);
  const sh = cur.get(off, 8);
  const maxSh = cur.get(off, 9);
  const ally = state.players[owner]?.team === state.players[state.localPlayer]?.team;
  if (kind === 3) {
    return (
      <div class="card small">
        <b>Wreck of {rule.name}</b>
        <p class="muted">Holdout harvesters and engineers can salvage it for credits.</p>
      </div>
    );
  }
  return (
    <div class="card small">
      <header>
        <b>{rule.name}</b>
        <span class={own ? 'good' : ally ? '' : 'bad'}>{own ? 'Yours' : ally ? 'Ally' : 'Enemy'}</span>
      </header>
      <div class="bar">
        <i style={{ width: `${(hp / Math.max(1, maxHp)) * 100}%` }} />
      </div>
      <div class="muted">
        HP {hp}/{maxHp}
        {maxSh > 0 ? ` · shields ${sh}/${maxSh}` : ''}
      </div>
      {rule.kind === 'unit' && rule.weapon && (
        <div class="muted">
          {DAMAGE_LABEL[rule.weapon.type]} · strong vs {strongVs(state.rules, rule.weapon.type).join(', ')}
        </div>
      )}
      {!own && !ally && <Matchup state={state} h={h} />}
      {!own && rule.kind === 'structure' && (rule as { role?: string }).role === 'tech' && <EnemyDoctrine state={state} player={owner} />}
      {own && rule.kind === 'unit' && <div class="activity">{activity(cur.get(off, 14), cur.get(off, 23), cur.get(off, 24))}</div>}
      {rule.kind === 'structure' && own && state.mode === 'sell' && (
        <div class="good" data-testid="sell-refund">Sell for {money(Math.floor((rule.cost * state.rules.constants.sellRefundPct) / 100))}</div>
      )}
      {rule.kind === 'structure' && own && state.mode === 'repair' && hp < maxHp && (
        <div data-testid="repair-cost">
          Full repair costs about {money(Math.ceil((((maxHp - hp) / maxHp) * rule.cost * state.rules.constants.repairCostPct) / 100))}
        </div>
      )}
      {rule.kind === 'structure' && <div class="muted">{rule.description}</div>}
    </div>
  );
}

function activity(order: number, hstate: number, cargo: number): string {
  if (hstate === 1) return cargo > 0 ? `Heading to Echo (${cargo} carried)` : 'Heading to Echo';
  if (hstate === 2) return `Harvesting (${cargo}/700)`;
  if (hstate === 3) return `Returning to refinery (${cargo})`;
  if (hstate === 4) return 'Waiting at refinery';
  if (hstate === 5) return 'Unloading';
  return ['Idle', 'Moving', 'Attack-moving', 'Attacking', 'Patrolling', 'Guarding', 'Salvaging'][order] ?? 'Idle';
}

/** How well the current selection's weapons do against an enemy (average damage-matrix percent). */
function Matchup({ state, h }: { state: ClientState; h: number }) {
  const armor = state.field(h, 1) === 2 ? 4 : (state.ruleOf(h) as UnitRule).armor;
  const air = armor === 3;
  let sum = 0;
  let n = 0;
  for (const u of state.selectedUnits()) {
    const w = (state.ruleOf(u) as UnitRule).weapon;
    if (!w || (air ? !w.targetsAir : !w.targetsGround)) continue;
    sum += state.rules.damageMatrix[w.type * ARMOR.length + armor]!;
    n++;
  }
  if (state.selectedUnits().length === 0) return null;
  if (n === 0) return <div class="matchup bad">Your selection can't hurt it</div>;
  const avg = Math.round(sum / n);
  const verdict = avg >= 100 ? ['good', 'Strong'] : avg >= 60 ? ['', 'Even'] : ['bad', 'Weak'];
  return (
    <div class={`matchup ${verdict[0]}`} data-testid="matchup">
      Your selection: {verdict[1]} ({avg}% damage)
    </div>
  );
}
