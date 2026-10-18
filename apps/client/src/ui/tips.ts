/** Short tips for the loading screen and the pause menu. */

export const GENERAL_TIPS = [
  'Build a second refinery beside a different Echo field: harvesters unload at the nearest one.',
  'Two or three harvesters keep a refinery busy. More just queue to unload.',
  'Space jumps to the latest alert. Press it again to step back through older ones.',
  'Ctrl+click a unit in the sidebar to keep building it until you right-click it.',
  'Hold Alt to see every health bar and the weapon range of your selection.',
  'Ctrl+F1 to F4 saves a camera spot; the F-key jumps back to it.',
  'Clicking the ground with units selected attack-moves: they fight what they meet. M then click for a plain move.',
  'Double-click a unit to select all of its type on screen; Ctrl+double-click for the whole map.',
  'Lost your construction yard? A standing refinery can build a new construction vehicle.',
  'The Codex (menu) lists what every unit is strong and weak against.',
];

export const FACTION_TIPS: Record<string, string[]> = {
  holdout: [
    'Holdout builds next to its own structures: grow your base outward toward the Echo.',
    'Select Grunts or Tankbusters and press F to dig in: 30% less damage taken and a little more range, but they cannot move.',
    'Any Holdout vehicle that drives over a wreck collects it for credits. Fight where the wrecks fall.',
    'Air-gapped: Halcyon Override holds Holdout machines only half as long.',
  ],
  halcyon: [
    'Halcyon builds only inside its network coverage: put a relay down first wherever you want to build next.',
    'Inside coverage your units fire faster and repair themselves, and Recompile pays back part of any unit lost there.',
    'Select a fork and press F for Uplink: it carries coverage with it for 15 seconds, even into the enemy base.',
    'Jam (Q, then click) makes enemy weapons in the area fire 20% slower for 5 seconds.',
  ],
  choir: [
    'The Choir grows freely on Echo near its own structures. A far seed needs one of your units standing nearby.',
    'Choir units sing together: each one within 3 tiles adds 2% damage, up to 6%.',
    'Badly hurt Choir units phase out or blink away on their own when under fire.',
    'Awaken (Q, then click an Echo field near your structures) raises two shard guardians for 20 seconds.',
  ],
};
