import { aiProfiles } from '@signal-fall/data';
import type { Sim } from '@signal-fall/sim';
import { AiPlayer } from './ai';
import { PROFILES, type Difficulty } from './difficulty';

/**
 * Put an AI in charge of `player`: applies the difficulty's income bonus and registers the brain.
 * `directed`: an autopilot that follows the player's directives (an AI agent's plan).
 */
export function attachAi(sim: Sim, player: number, difficulty: Difficulty, starts: { x: number; y: number }[], opts: { directed?: boolean } = {}): AiPlayer {
  const p = sim.world.players[player]!;
  const faction = sim.world.rules.factions[p.faction]!;
  const profile = aiProfiles().get(faction.id);
  if (!profile) throw new Error(`no AI profile for ${faction.id}`);
  // An autopilot gets the AI's hands, never its handicap or bonus.
  p.incomeBonusPct = opts.directed ? 0 : PROFILES[difficulty].incomeBonusPct;
  const ai = new AiPlayer({ player, difficulty, profile, starts, directed: opts.directed });
  sim.addBrain(ai);
  return ai;
}
