/** Faction lore and identity (from the design doc). */
export const FACTION_LORE: Record<string, { tagline: string; story: string; look: string; twists: [string, string][]; play: string }> = {
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
      ['Shards, not hulls', 'Units have regenerating shields over a small health pool. Shields recharge out of combat; there is no repair. Bullets glance off shields, but energy weapons tear through them.'],
      ['Phase', 'Many units can blink (press F, then click where) or phase out (F) for a moment.'],
    ],
    play: 'Mobile, hit-and-run, punishes poor positioning; weak to sustained burst damage.',
  },
};
