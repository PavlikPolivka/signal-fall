/** Faction lore and identity (from the design doc). */
export const FACTION_LORE: Record<string, { tagline: string; story: string; look: string; twists: [string, string][]; play: string }> = {
  holdout: {
    tagline: 'The last stand',
    story:
      'The survivors abandoned anything networked, because networked meant hijacked. Their machines are analog and diesel-heavy: armored crawlers, cable-guided missiles, crewed walkers, flak.',
    look: 'Olive and rust, welded plates, exhaust, searchlights.',
    twists: [
      ['Dig In', 'Grunts and Tankbusters entrench behind sandbags (F): 30% less damage and 1 tile more range, but they cannot move until given an order.'],
      ['Air-gapped', 'No network to hijack: Halcyon\'s Override holds Holdout machines only half as long.'],
      ['Salvage', 'Any Holdout vehicle that drives over a wreck, from any faction, turns it into credits: 15% of its value.'],
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
      ['Coverage', 'Buildings and relays project network coverage (the cyan grid): units inside fire 12% faster and repair 2 HP a second. Buildings can only be placed inside coverage.'],
      ['Uplink', 'The fork engineer carries the network with it for 15 s (F): coverage wherever the fight is.'],
      ['Jam', 'Support power from the scan (Q): enemy weapons in an area fire 20% slower for 5 s. Air-gapped Holdout is immune.'],
      ['Recompile', 'A unit destroyed inside coverage refunds part of its cost.'],
      ['Override', 'A tier-3 ability briefly takes control of an enemy machine (Choir and Holdout machines break free twice as fast).'],
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
      ['Phase', 'Many units can blink (press F, then click where) or phase out (F) for a moment. Badly hurt under fire, they do it on their own.'],
      ['Chorus', 'Choir units harmonize: each one within 3 tiles adds 2% damage, up to +6%. Thin violet threads show who is singing together.'],
      ['Awaken', 'Support power from the Chord (Q): click an Echo field near your structures and two shard guardians rise from its crystals to fight for 20 s.'],
    ],
    play: 'Mobile, hit-and-run, punishes poor positioning; weak to sustained burst damage.',
  },
};
