import { describe, expect, it } from 'vitest';
import { parseFactions, runMatch } from '../src/run';

describe('headless runner', () => {
  it('is deterministic across runs', () => {
    const opts = { seed: 3, ticks: 400, factions: parseFactions('holdout,choir'), size: 96 };
    const a = runMatch(opts);
    const b = runMatch(opts);
    expect(a.ticks).toBe(400);
    expect(a.hashes).toHaveLength(20);
    expect(a.hashes).toEqual(b.hashes);
    expect(a.finalHash).toBe(b.finalHash);
  });

  it('rejects unknown factions', () => {
    expect(() => parseFactions('holdout,zerg')).toThrow(/zerg/);
  });
});
