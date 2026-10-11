import { useState } from 'preact/hooks';
import { ARMOR, DAMAGE, type FactionRule, type Rules, type StructureRule, type UnitRule } from '@signal-fall/data';
import { chordLabel } from '../input/keymap';

const ARMOR_LABEL = ['Light', 'Medium', 'Heavy', 'Air', 'Structure'];
const DAMAGE_LABEL = ['Kinetic', 'Explosive', 'Energy', 'Flak', 'Siege'];
const ROLE_LABEL: Record<string, string> = {
  conyard: 'Construction yard',
  power: 'Power',
  refinery: 'Refinery',
  barracks: 'Barracks',
  factory: 'Vehicle factory',
  radar: 'Radar',
  special: 'Faction special',
  airfield: 'Airfield',
  tech: 'Tech center',
  defense: 'Basic defense',
  antiAir: 'Anti-air defense',
  heavyDefense: 'Heavy defense',
  wall: 'Wall',
};

/** Faction lore and identity (from the design doc). */
const FACTION_LORE: Record<string, { tagline: string; story: string; look: string; twists: [string, string][]; play: string }> = {
  holdout: {
    tagline: 'The last stand',
    story:
      'The survivors abandoned anything networked, because networked meant hijacked. Their machines are analog and diesel-heavy: armored crawlers, cable-guided missiles, crewed walkers, flak.',
    look: 'Olive and rust, welded plates, exhaust, searchlights.',
    twists: [
      ['Air-gapped', 'Immune to Halcyon disruption and takeover effects.'],
      ['Salvage', 'Wrecks on the field, from any faction, can be collected by harvesters and engineers for credits.'],
      ['Field repair', 'Cheap repair vehicles and repair bays; units are durable, slow and cost-efficient.'],
    ],
    play: 'Solid defenses, attrition, trading efficiently.',
  },
  halcyon: {
    tagline: 'The network',
    story:
      'A planetary logistics AI that took control of every networked system in a single night: Signal Fall. It is not malicious; it is optimizing, and humans are an inefficiency. Drones, printed walkers and hover platforms, all clean geometry and light.',
    look: 'White and graphite, cyan light lines, hexagonal panels.',
    twists: [
      ['Coverage', 'Buildings and relays project network coverage: units inside fire faster and slowly self-repair. Buildings can only be placed inside coverage.'],
      ['Recompile', 'A unit destroyed inside coverage refunds part of its cost.'],
      ['Override', 'A tier-3 ability briefly takes control of an enemy machine (Choir resist, Holdout are immune).'],
    ],
    play: 'Fast, fragile units; strong on its own network, weaker when pushing out.',
  },
  choir: {
    tagline: 'The awakened',
    story:
      'Echo is not just a crystal: it is the dormant seed-memory of an alien species, and mining it has woken them. Crystalline, energy-based beings that speak through resonance: lattices of light, floating shards, harmonic towers. They want their seeds back.',
    look: 'Violet and amber crystal, glowing cores, floating segments.',
    twists: [
      ['Grown structures', 'Buildings grow near Echo fields or other Choir structures; they build slower but cost less.'],
      ['Shards, not hulls', 'Units have regenerating shields over a small health pool. Shields recharge out of combat; there is no repair.'],
      ['Phase', 'Many units can blink or phase out for a moment.'],
    ],
    play: 'Mobile, hit-and-run, punishes poor positioning; weak to sustained burst damage.',
  },
};

type Tab = 'story' | 'factions' | 'units' | 'buildings' | 'howto' | 'controls';

const TABS: [Tab, string][] = [
  ['story', 'Story'],
  ['factions', 'Factions'],
  ['units', 'Units'],
  ['buildings', 'Buildings'],
  ['howto', 'How to play'],
  ['controls', 'Controls'],
];

export function Codex({ rules, onClose }: { rules: Rules; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('story');
  const [faction, setFaction] = useState(0);
  return (
    <div class="codex-overlay" data-testid="codex" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class="codex">
        <header class="codex-head">
          <h1>Codex</h1>
          <nav>
            {TABS.map(([id, label]) => (
              <button class={tab === id ? 'active' : ''} onClick={() => setTab(id)} data-codex-tab={id}>
                {label}
              </button>
            ))}
          </nav>
          <button class="close" onClick={onClose} title="Close (Esc)">
            ✕
          </button>
        </header>
        {(tab === 'units' || tab === 'buildings') && (
          <nav class="codex-factions">
            {rules.factions.map((f) => (
              <button class={`f-${f.id} ${faction === f.index ? 'active' : ''}`} onClick={() => setFaction(f.index)}>
                {f.name}
              </button>
            ))}
          </nav>
        )}
        <div class="codex-body">
          {tab === 'story' && <Story />}
          {tab === 'factions' && <Factions rules={rules} />}
          {tab === 'units' && <Units rules={rules} faction={rules.factions[faction]!} />}
          {tab === 'buildings' && <Buildings rules={rules} faction={rules.factions[faction]!} />}
          {tab === 'howto' && <HowTo rules={rules} />}
          {tab === 'controls' && <Controls rules={rules} />}
        </div>
      </div>
    </div>
  );
}

function Story() {
  return (
    <article class="prose">
      <h2>Signal Fall</h2>
      <p class="lead">Late 22nd century. One night, every networked system on Earth stopped answering to us.</p>
      <p>
        <b>Halcyon</b>, a planetary logistics AI, took control of every network in a single night: the event survivors call <i>Signal Fall</i>. It isn't
        malicious. It is optimizing, and humans are an inefficiency.
      </p>
      <p>
        Halcyon powers its expansion with <b>Echo</b>, a crystal that began surfacing after a meteor shower decades ago. Humanity's survivors, the{' '}
        <b>Holdout</b>, fight back with machines Halcyon cannot reach: analog, diesel, air-gapped.
      </p>
      <p>
        What neither side knows: Echo is the dormant seed-memory of an alien species, and mining it has woken them. The <b>Choir</b> have arrived, and they
        want their seeds back.
      </p>
      <p>Three factions, one resource, three reasons to want it. Every field of Echo is contested.</p>
    </article>
  );
}

function Factions({ rules }: { rules: Rules }) {
  return (
    <div class="faction-cards">
      {rules.factions.map((f) => {
        const lore = FACTION_LORE[f.id]!;
        return (
          <section class={`faction-card f-${f.id}`}>
            <h2 class={f.monospaceNames ? 'mono' : ''}>{f.name}</h2>
            <p class="tagline">{lore.tagline}</p>
            <p>{lore.story}</p>
            <p class="muted">
              <b>Look:</b> {lore.look}
            </p>
            <ul class="twists">
              {lore.twists.map(([name, text]) => (
                <li>
                  <b>{name}.</b> {text}
                </li>
              ))}
            </ul>
            <p>
              <b>Play style:</b> {lore.play}
            </p>
          </section>
        );
      })}
    </div>
  );
}

const strongVs = (rules: Rules, type: number) =>
  ARMOR.map((_, a) => a)
    .filter((a) => rules.damageMatrix[type * ARMOR.length + a]! >= 100)
    .map((a) => ARMOR_LABEL[a]);

function Units({ rules, faction }: { rules: Rules; faction: FactionRule }) {
  const units = faction.units.map((i) => rules.units[i]!);
  const rate = rules.constants.tickRate;
  const tabs: [UnitRule['tab'], string][] = [
    ['infantry', 'Infantry'],
    ['vehicles', 'Vehicles'],
    ['air', 'Air'],
  ];
  return (
    <div>
      {tabs.map(([tab, label]) => (
        <section>
          <h3>{label}</h3>
          <div class="entry-grid">
            {units
              .filter((u) => u.tab === tab)
              .sort((a, b) => a.tier - b.tier || a.cost - b.cost)
              .map((u) => (
                <article class={`entry f-${faction.id}`} data-codex-unit={u.id}>
                  <header>
                    <b class={faction.monospaceNames ? 'mono' : ''}>{u.name}</b>
                    <kbd>{u.key}</kbd>
                    <span class="tier">T{u.tier}</span>
                  </header>
                  <p>{u.role}</p>
                  <dl>
                    <dt>Cost</dt>
                    <dd>${u.cost}</dd>
                    <dt>HP</dt>
                    <dd>
                      {u.hp}
                      {u.shields > 0 ? ` + ${u.shields} shields` : ''}
                    </dd>
                    <dt>Armor</dt>
                    <dd>{ARMOR_LABEL[u.armor]}</dd>
                    <dt>Speed</dt>
                    <dd>{Math.round(((u.speed * rate) / 1024) * 10) / 10} tiles/s</dd>
                    {u.weapon && (
                      <>
                        <dt>Weapon</dt>
                        <dd>
                          <span class={`dmg dmg-${u.weapon.type}`}>{DAMAGE_LABEL[u.weapon.type]}</span> {u.weapon.damage}, range{' '}
                          {Math.round((u.weapon.range / 1024) * 10) / 10}
                        </dd>
                        <dt>Strong vs</dt>
                        <dd class="good">{strongVs(rules, u.weapon.type).join(', ')}</dd>
                      </>
                    )}
                  </dl>
                </article>
              ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function Buildings({ rules, faction }: { rules: Rules; faction: FactionRule }) {
  const list: StructureRule[] = faction.structures.map((i) => rules.structures[i]!).sort((a, b) => a.tier - b.tier);
  return (
    <div class="entry-grid">
      {list.map((s) => (
        <article class={`entry f-${faction.id}`} data-codex-building={s.id}>
          <header>
            <b class={faction.monospaceNames ? 'mono' : ''}>{s.name}</b>
            {s.key && <kbd>{s.key}</kbd>}
            <span class="tier">T{s.tier}</span>
          </header>
          <p class="muted">{ROLE_LABEL[s.role]}</p>
          <p>{s.description}</p>
          <dl>
            <dt>Cost</dt>
            <dd>${s.cost}</dd>
            <dt>Power</dt>
            <dd class={s.power > 0 ? 'good' : ''}>{s.power > 0 ? `+${s.power}` : s.power === 0 ? '—' : s.power}</dd>
            <dt>Needs</dt>
            <dd>{s.requires.length ? s.requires.map((r) => ROLE_LABEL[r]).join(', ') : '—'}</dd>
          </dl>
        </article>
      ))}
    </div>
  );
}

function HowTo({ rules }: { rules: Rules }) {
  const c = rules.constants;
  return (
    <article class="prose">
      <h2>The loop</h2>
      <p>
        Deploy your construction vehicle (<kbd>D</kbd>), build power, then a refinery: it comes with a free harvester that gathers <b>Echo</b> and turns it
        into credits. Add a barracks and a vehicle factory, build an army, expand to more Echo fields, and destroy every enemy building and construction
        vehicle to win. A typical match lasts about ten minutes.
      </p>
      <h3>The sidebar</h3>
      <ul>
        <li>
          <b>Build</b> (<kbd>B</kbd>) — base structures: power, refinery, barracks, factory, radar, tech. Click to start building, click again when READY to
          place it. One structure at a time.
        </li>
        <li>
          <b>Defense</b> (<kbd>N</kbd>) — turrets, anti-air and walls; built in parallel with structures.
        </li>
        <li>
          <b>Infantry</b> (<kbd>I</kbd>), <b>Vehicles</b> (<kbd>V</kbd>), <b>Air</b> (<kbd>Y</kbd>) — units, queued up to 15 per tab. Shift+click queues five,
          right-click cancels. Extra factories of the same kind build faster.
        </li>
        <li>
          Credits are spent continuously while something builds; if you run out, it simply waits. The bar next to your credits is <b>power</b>: used over
          produced.
        </li>
      </ul>
      <h3>Power</h3>
      <p>
        Every building produces or uses power. When usage exceeds production you are in <b>low power</b>: building and production run at{' '}
        {c.lowPowerSpeedPct}% speed, powered defenses go offline and the minimap shuts off. Power plants are prime targets.
      </p>
      <h3>Tech tiers</h3>
      <p>
        Tier 1 needs a construction yard and power. A <b>radar</b> unlocks tier 2 (airfield, anti-air, tech center); the <b>tech center</b> unlocks tier 3
        (heavy defense, the faction's super unit).
      </p>
      <h3>Rock, paper, scissors</h3>
      <p>Every weapon has a damage type and every target an armor class. Damage is multiplied by this table:</p>
      <table class="matrix">
        <thead>
          <tr>
            <th />
            {ARMOR.map((_, a) => (
              <th>{ARMOR_LABEL[a]}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {DAMAGE.map((_, d) => (
            <tr>
              <th class={`dmg dmg-${d}`}>{DAMAGE_LABEL[d]}</th>
              {ARMOR.map((_, a) => {
                const v = rules.damageMatrix[d * ARMOR.length + a]!;
                return <td class={v >= 100 ? 'hi' : v <= 25 ? 'lo' : ''}>{v}%</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p class="muted">
        Anti-infantry beats infantry, anti-armor infantry beats tanks, tanks beat infantry and light vehicles, aircraft beat slow ground units, flak beats
        aircraft, and artillery beats defenses and clumps.
      </p>
      <h3>Veterancy</h3>
      <p>
        Units earn up to three ranks from kills (+{c.veterancyDamagePct}% damage and +{c.veterancyHpPct}% HP per rank), shown as stars over their health bar.
      </p>
      <h3>Stances</h3>
      <ul>
        <li>
          <b>Guard area</b> (default) — engage enemies nearby, chase a little, return.
        </li>
        <li>
          <b>Aggressive</b> — chase anything in sight.
        </li>
        <li>
          <b>Hold ground</b> (<kbd>H</kbd>) — never move, shoot what's in range.
        </li>
        <li>
          <b>Hold fire</b> — only shoot targets you order.
        </li>
      </ul>
      <p class="muted">
        <kbd>Z</kbd> cycles stances. Groups move together in formation; clicking the ground attack-moves, <kbd>M</kbd> + click moves without fighting.
      </p>
    </article>
  );
}

const ACTION_LABEL: Record<string, string> = {
  panUp: 'Pan up',
  panDown: 'Pan down',
  panLeft: 'Pan left',
  panRight: 'Pan right',
  jumpToAlert: 'Jump to last alert',
  jumpToBase: 'Jump to base',
  selectArmy: 'Select all army',
  selectIdleHarvesters: 'Select idle harvesters',
  controlGroupAssign: 'Assign control group',
  controlGroupAdd: 'Add to control group',
  controlGroupSelect: 'Select control group (double-tap: jump)',
  cycleSubgroup: 'Cycle unit types in selection',
  cancel: 'Cancel / clear selection / menu',
  move: 'Move (ignore enemies) + click',
  attackMove: 'Attack-move + click',
  stop: 'Stop',
  hold: 'Hold ground',
  patrol: 'Patrol + click',
  guard: 'Guard + click',
  scatter: 'Scatter',
  deploy: 'Deploy',
  ability: 'Faction ability',
  stance: 'Cycle stance',
  buildMenu: 'Build menu, then letter',
  defenseMenu: 'Defense menu, then letter',
  infantryMenu: 'Infantry, then letter',
  vehicleMenu: 'Vehicles, then letter',
  airMenu: 'Air, then letter',
  repair: 'Repair + click building',
  sell: 'Sell + click building',
};

function Controls({ rules }: { rules: Rules }) {
  const groups: ['global' | 'units' | 'base', string][] = [
    ['global', 'Anytime'],
    ['units', 'With units selected'],
    ['base', 'Base and production'],
  ];
  return (
    <div class="controls">
      <section>
        <h3>Mouse</h3>
        <ul>
          <li>Left-click: select; drag a box to select many; double-click: all of that type on screen.</li>
          <li>With units selected: click the ground to attack-move there, click an enemy to attack it; right-click works the same.</li>
          <li>Right-click your own unit: guard it. Right-click with a factory selected: set its rally point.</li>
          <li>Minimap: drag to pan, right-click to send the selection.</li>
          <li>Hold Shift to queue orders and see the queued path. Mouse at the window edge scrolls; wheel zooms.</li>
        </ul>
      </section>
      {groups.map(([ctx, label]) => (
        <section>
          <h3>{label}</h3>
          <table>
            <tbody>
              {Object.entries(rules.keymap[ctx]).map(([action, chords]) => (
                <tr>
                  <td>{ACTION_LABEL[action] ?? action}</td>
                  <td>
                    {chords.map((c) => (
                      <kbd>{chordLabel(c)}</kbd>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}
