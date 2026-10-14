/** Announcer line ids (files in assets/voice/<faction>/<id>.mp3, made by tools/assets/voices). */
export type VoiceLine =
  | 'construction_complete'
  | 'unit_ready'
  | 'base_attack'
  | 'harvester_attack'
  | 'units_attack'
  | 'low_power'
  | 'no_money'
  | 'cant_build'
  | 'structure_lost'
  | 'unit_lost'
  | 'research_complete'
  | 'new_options'
  | 'field_depleted'
  | 'victory'
  | 'defeat';

/** Never repeat a line sooner than this (ms); busy battles would otherwise talk over themselves. */
const COOLDOWN: Partial<Record<VoiceLine, number>> = {
  base_attack: 15000,
  harvester_attack: 15000,
  units_attack: 20000,
  unit_lost: 12000,
  structure_lost: 6000,
  no_money: 10000,
  cant_build: 4000,
  low_power: 20000,
  field_depleted: 20000,
};
const DEFAULT_COOLDOWN = 2500;
/** Urgent lines go to the front of the queue. */
const URGENT = new Set<VoiceLine>(['base_attack', 'victory', 'defeat', 'structure_lost']);
/** A line still waiting after this long is no longer news. */
const STALE_MS = 3500;

/**
 * The announcer: one line at a time, urgent ones first, nothing stale, nothing repeated too
 * often. Lines load lazily per faction and are decoded once.
 */
export class VoicePlayer {
  private buffers = new Map<VoiceLine, Promise<AudioBuffer | null>>();
  private queue: { line: VoiceLine; at: number }[] = [];
  private lastSaid = new Map<VoiceLine, number>();
  private speaking = false;
  /** Lines spoken so far (tests, debugging). */
  readonly history: VoiceLine[] = [];
  /** Called when a line starts and stops (to duck the music). */
  onSpeaking: (speaking: boolean) => void = () => undefined;

  constructor(
    private readonly ctx: AudioContext,
    private readonly out: AudioNode,
    private readonly faction: string,
  ) {}

  private load(line: VoiceLine): Promise<AudioBuffer | null> {
    let p = this.buffers.get(line);
    if (!p) {
      p = fetch(`${import.meta.env.BASE_URL}assets/voice/${this.faction}/${line}.mp3`)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
        .then((b) => this.ctx.decodeAudioData(b))
        .catch(() => null);
      this.buffers.set(line, p);
    }
    return p;
  }

  /** Warm the cache for the lines every match uses. */
  preload(): void {
    for (const l of ['construction_complete', 'unit_ready', 'base_attack', 'no_money', 'low_power'] as const) void this.load(l);
  }

  say(line: VoiceLine): void {
    const now = performance.now();
    if (now - (this.lastSaid.get(line) ?? -1e9) < (COOLDOWN[line] ?? DEFAULT_COOLDOWN)) return;
    if (this.queue.some((q) => q.line === line)) return;
    this.lastSaid.set(line, now);
    const item = { line, at: now };
    if (URGENT.has(line)) this.queue.unshift(item);
    else this.queue.push(item);
    void this.next();
  }

  private async next(): Promise<void> {
    if (this.speaking) return;
    const now = performance.now();
    this.queue = this.queue.filter((q) => URGENT.has(q.line) || now - q.at < STALE_MS);
    const item = this.queue.shift();
    if (!item) return;
    this.speaking = true;
    const buf = await this.load(item.line);
    if (!buf) {
      this.speaking = false;
      void this.next();
      return;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.out);
    this.onSpeaking(true);
    this.history.push(item.line);
    src.onended = () => {
      this.speaking = false;
      this.onSpeaking(false);
      void this.next();
    };
    src.start();
  }
}
