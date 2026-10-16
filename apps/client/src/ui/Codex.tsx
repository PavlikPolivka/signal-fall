import { useState } from 'preact/hooks';
import { ARMOR, DAMAGE, type FactionRule, type Rules, type StructureRule, type UnitRule } from '@signal-fall/data';
import { CHOIR_ECHO_RANGE, CHOIR_ECHO_REACH, CHOIR_SEED_GROW_PCT, CHOIR_SEED_REACH, CHOIR_SEED_START_PCT } from '@signal-fall/sim';
import { chordLabel } from '../input/keymap';
import { roleNames } from '../game/names';
import { FACTION_LORE } from './lore';
import { BalanceReport } from './Balance';

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


type Tab = 'story' | 'factions' | 'compare' | 'units' | 'buildings' | 'howto' | 'controls' | 'balance';

const TABS: [Tab, string][] = [
  ['story', 'Story'],
  ['factions', 'Factions'],
  ['compare', 'Differences'],
  ['units', 'Units'],
  ['buildings', 'Buildings'],
  ['howto', 'How to play'],
  ['controls', 'Controls'],
  ['balance', 'Balance'],
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
          {tab === 'compare' && <Compare />}
          {tab === 'units' && <Units rules={rules} faction={rules.factions[faction]!} />}
          {tab === 'buildings' && <Buildings rules={rules} faction={rules.factions[faction]!} />}
          {tab === 'howto' && <HowTo rules={rules} />}
          {tab === 'controls' && <Controls rules={rules} />}
          {tab === 'balance' && <BalanceReport rules={rules} />}
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

/** Side by side: how the three factions differ, row by row. */
const COMPARE: [string, string, string, string][] = [
  ['Builds', 'Next to the base, step by step', 'Anywhere inside network coverage', 'Grown near Echo or Choir structures'],
  ['Expands with', 'Homestead (deploys a new base)', 'init, or relays pushing coverage out', 'Overture, or a far seed beside a field'],
  ['Harvester', 'Mule: slow and the toughest', 'fetch: fastest harvester', 'Refrain: shields over a light hull'],
  ['Units', 'Slow, tough, cost-efficient', 'Fast and fragile', 'Small hulls under regenerating shields'],
  ['Healing', 'Garage bays, Patch, Wrench repair', 'Self-repair inside coverage', 'Shields recharge out of combat; no repair'],
  ['Losses', 'Vehicles turn wrecks into credits as they pass', 'Recompile refunds units lost in coverage', 'Shields absorb the first hits'],
  ['Special', 'Dig In; Override holds them half as long', 'Uplink, Jam (Q) and Override', 'Blink and phase'],
  ['Fights best', 'Holding ground, slow pushes', 'On its own network', 'Hit-and-run, flanks'],
  ['Struggles', 'Being outmaneuvered', 'Far from its network', 'Long, sustained fights'],
];

/** One faction in a match: how a game typically goes, with real units and buildings. */
const IN_A_MATCH: Record<string, { opening: string; examples: string[]; against: [string, string][] }> = {
  holdout: {
    opening:
      'Dynamo, Smelter, Bunkhouse, Motor Pool. Each building has to sit within a few tiles of another, so the base creeps toward the next field like a wall.',
    examples: [
      'A Bulldog column with a Patch behind it keeps rolling: the Patch repairs the tanks while they fight, and damaged ones drive back to a Garage.',
      'After a big fight, drive any vehicle over the wrecks: every wreck on the field, yours or theirs, turns into credits.',
      'Grunts and Tankbusters dug in at a choke (F) take 30% less damage and outrange the attackers. Any order packs them up again.',
      'A Halcyon root grabs your Ironclad with Override, but it breaks free twice as fast as anyone else\'s. Holdout machines have no network to hold.',
      'Thumpers out-range every base defense: park them behind a Pillbox line and shell the enemy base from safety.',
    ],
    against: [
      ['vs Halcyon', 'Fight away from its relays. Kill the relays and its army loses faster fire and self-repair.'],
      ['vs Choir', 'Bullets glance off shields, so lean on explosives: Tankbusters, Bulldogs and Thumpers. Keep the pressure on, since shields only recharge once the fighting stops.'],
    ],
  },
  halcyon: {
    opening:
      'kernel, powerd, ingest, spawn, make. Everything must stand inside coverage, so drop a relay ($400) first wherever you want to build next.',
    examples: [
      'A chain of relays toward the next field lets an init deploy there, and gives every unit on the way faster fire and self-repair.',
      'Pushing out of the network? Bring a fork and press F: Uplink carries the coverage with it for 15 s, so the army around it keeps its faster fire, repair and Recompile in the enemy\'s base.',
      'Their Graces and Bassos dive your line: press Q and click them. Jam slows their fire by 20% for 5 s, which can swing the fight.',
      'Lose a vector inside your own coverage and Recompile hands back a quarter of its cost. Defending at home is cheap.',
      'pings are the fastest scouts in the game: find the enemy harvesters and send seeks after them.',
      'Late in a match, a root uses Override to turn the enemy\'s best tank against its own army (Choir and Holdout machines break free twice as fast).',
    ],
    against: [
      ['vs Holdout', 'Jam does nothing against air-gapped Holdout, so Uplink is your edge. Do not trade head-on with Bulldogs. Pick them apart with seeks and broadcast artillery, and fight inside coverage.'],
      ['vs Choir', 'Energy weapons tear through shields: sentries and vectors are your best answer.'],
    ],
  },
  choir: {
    opening:
      'Opus, Bell, Coda, Loft, Pit. Structures grow near Echo or other Choir buildings: they take longer than the others to build, but cost less.',
    examples: [
      'A Glissando scouts a far field and stays there: with your unit beside it, the field can take a far seed. The new Coda grows from a quarter of its strength, so keep the Glissando around until it has.',
      'Graces blink onto enemy artillery, kill it and blink out. Their shields recharge before the next raid.',
      'A Basso about to die phases out, comes back a moment later, and its shields refill while it waits.',
      'A Chord beside a field makes the Echo there regrow twice as fast. Sit on it and the field almost never runs dry.',
    ],
    against: [
      ['vs Holdout', 'Bullets glance off your shields: hit fast and leave before the Patches and Garages repair the damage.'],
      ['vs Halcyon', 'Its energy weapons cut through shields. Strike outside its coverage, where it neither fires faster nor repairs.'],
    ],
  },
};

function Compare() {
  const names = ['Holdout', 'Halcyon', 'Choir'];
  const ids = ['holdout', 'halcyon', 'choir'];
  return (
    <article class="prose compare">
      <h2>How the factions differ</h2>
      <p class="lead">One resource, three ways to play. All three follow the same rules whether a player or the AI commands them.</p>
      <table class="md-table compare-table">
        <thead>
          <tr>
            <th />
            {names.map((n, i) => (
              <th class={`f-${ids[i]}`}>{n}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {COMPARE.map(([row, ...cells]) => (
            <tr>
              <th>{row}</th>
              {cells.map((c) => (
                <td>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {ids.map((id, i) => {
        const m = IN_A_MATCH[id]!;
        return (
          <section class={`f-${id}`}>
            <h2>{names[i]} in a match</h2>
            <p>
              <b>Opening.</b> {m.opening}
            </p>
            <ul>
              {m.examples.map((e) => (
                <li>{e}</li>
              ))}
            </ul>
            {m.against.map(([vs, tip]) => (
              <p class="muted">
                <b>{vs}:</b> {tip}
              </p>
            ))}
          </section>
        );
      })}
    </article>
  );
}

const strongVs = (rules: Rules, type: number) =>
  ARMOR.map((_, a) => a)
    .filter((a) => rules.damageMatrix[type * ARMOR.length + a]! >= 100)
    .map((a) => ARMOR_LABEL[a]);

const BASE = import.meta.env.BASE_URL;
/** Team color shown in the codex art, per faction. */
const CODEX_TEAM = ['#3d8bfd', '#3ee6ff', '#e0a640'];

/** Rendered picture of a unit or building, team areas tinted; hidden if the image is missing. */
function Art({ faction, id }: { faction: FactionRule; id: string }) {
  const url = `${BASE}assets/icons/${faction.id}/${id}`;
  return (
    <div class="entry-art">
      <img src={`${url}.png`} alt="" loading="lazy" onError={(e) => ((e.currentTarget as HTMLElement).parentElement!.style.display = 'none')} />
      <i class="tint" style={{ background: CODEX_TEAM[faction.index], maskImage: `url(${url}.mask.png)`, WebkitMaskImage: `url(${url}.mask.png)` }} />
    </div>
  );
}

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
                  <Art faction={faction} id={u.id} />
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
          <Art faction={faction} id={s.id} />
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
            <dd>{s.requires.length ? roleNames(rules, faction.index, s.requires) : '—'}</dd>
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
          <b>Build</b> (<kbd>B</kbd>) — base structures: power, refinery, barracks, factory, radar, tech. Click a building, then click where it should go:
          it builds and places itself when done. Clicking it again instead starts it without a spot, to place when READY. One structure at a time.
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
      <BuildingRules rules={rules} />
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
      <h3>Game modes</h3>
      <ul>
        <li>
          <b>Skirmish vs AI</b> — 1 vs 1, or 2 vs 2 with an AI ally against two AIs. Pick factions, difficulty and the map.
        </li>
        <li>
          <b>Multiplayer</b> — create a room and send its four-letter code. 1 vs 1 or 2 vs 2; the host fills any seat with an AI, so two friends can
          take on two AIs together, or three people can share a match with one AI. Everyone connects directly to everyone else.
        </li>
      </ul>
      <p class="muted">Teammates share vision, cannot hurt each other, and win or lose together.</p>
      <h3>After the match</h3>
      <p>
        <b>Match report</b> on the end screen compares both sides: Echo harvested, units built, kills and losses, and the value destroyed. Charts show
        income, army value, and the value destroyed and lost over time. <b>Save replay</b> downloads the match. Open it with <b>Watch a replay</b> in the
        main menu to watch it again at up to 8× speed. The replay is checked against the original result.
      </p>
      <h3>Your account</h3>
      <p>
        You start as a <b>guest</b>: the account lives in this browser. Open <b>Account</b> in the main menu to pick your name (opponents see it in
        multiplayer). Add your email and open the link we send to keep the account for good, with the same name and history, and sign in to it on any
        device.
      </p>
      <h3>AI agents</h3>
      <p>
        Language models and other programs can play Signal Fall through its agent server (MCP), seeing only what a player would see and sending the same
        commands. A seat played by an agent is always marked <b class="agent-tag">AI agent</b> with its name and model, in replays and in match
        reports. How to connect one: <code>docs/AGENTS.md</code> in the source.
      </p>
      <h3>Stats and the leaderboard</h3>
      <p>
        Every finished match is recorded when you are online: <b>Stats</b> in the main menu lists your history and your record per faction and AI
        difficulty. Multiplayer 1v1 matches are <b>rated</b> (Elo, starting at 1200) once both players' games report the same result; the leaderboard
        shows saved accounts.
      </p>
    </article>
  );
}

const tiles = (fx: number) => Math.round((fx / 1024) * 10) / 10;

/** Where each faction may build, how to expand, and what refineries are for. */
function BuildingRules({ rules }: { rules: Rules }) {
  const by = (p: FactionRule['placement']) => rules.factions.find((f) => f.placement === p)!;
  const holdout = by('adjacent');
  const halcyon = by('coverage');
  const choir = by('growth');
  const radii = (f: FactionRule, key: 'coverageRadius' | 'growthRadius') =>
    f.structures
      .map((i) => rules.structures[i]!)
      .filter((s) => s[key] > 0)
      .map((s) => `${s.name} ${tiles(s[key])}`)
      .join(', ');
  const conyard = (f: FactionRule) => f.structures.map((i) => rules.structures[i]!).find((s) => s.role === 'conyard')!.name;
  const refinery = (f: FactionRule) => rules.structures[f.structures.find((i) => rules.structures[i]!.role === 'refinery')!]!;
  return (
    <>
      <h3>Where you can build</h3>
      <p>Every faction builds by its own rule. The same rules apply to players and to the AI.</p>
      <ul>
        <li>
          <b>{holdout.name}</b> — next to the base: a new building must be within {holdout.adjacencyRange} tiles of one you already have. Grow the base
          step by step toward where you want to be.
        </li>
        <li>
          <b>{halcyon.name}</b> — inside network coverage: within reach of a building that projects it ({radii(halcyon, 'coverageRadius')} tiles). Cheap
          relays push coverage outward.
        </li>
        <li>
          <b>{choir.name}</b> — grown, not built: near a structure that spreads growth ({radii(choir, 'growthRadius')} tiles), or within{' '}
          {CHOIR_ECHO_RANGE} tiles of Echo. Echo within {CHOIR_ECHO_REACH} tiles of your own structures grows as usual. A farther field needs the chorus
          there: one of your units within {CHOIR_SEED_REACH} tiles of the spot. Such a <b>far seed</b> starts at {CHOIR_SEED_START_PCT}% health and grows{' '}
          {CHOIR_SEED_GROW_PCT}% a second to full strength, so guard it while it grows.
        </li>
      </ul>
      <h3>Expanding</h3>
      <p>
        Fields run dry and regrow slowly, so a base that stays home runs out of money. To take another field, build a construction vehicle at the factory
        and deploy it (<kbd>D</kbd>) beside the field: it becomes a new construction yard ({rules.factions.map(conyard).join(', ')}), and the
        building rules above start from there. The {choir.name} can also grow straight onto a far field with a far seed.
      </p>
      <h3>Refineries and harvesters</h3>
      <p>
        A refinery (${Math.min(...rules.factions.map((f) => refinery(f).cost))}–${Math.max(...rules.factions.map((f) => refinery(f).cost))}) comes with one free harvester. Harvesters
        unload at the nearest refinery, so a second refinery pays off only beside a different field, where it cuts the drive. On the same field, another
        harvester is cheaper. About three harvesters keep one refinery busy; more just queue to unload.
      </p>
    </>
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
  cancel: 'Cancel / clear selection / close menu',
  menu: 'Open or close the menu',
  mute: 'Mute or unmute all sound',
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
  supportPower: 'Support power (Jam, Awaken) + click the map',
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
          <li>With units selected: click the ground to attack-move there, click an enemy to attack it.</li>
          <li>With a factory or barracks selected: click the ground to set its rally point.</li>
          <li>Right-click anywhere: deselect (or cancel placing a building / a targeting mode).</li>
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
