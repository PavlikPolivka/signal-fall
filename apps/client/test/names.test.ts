import { describe, expect, it } from 'vitest';
import { defaultRules } from '@signal-fall/data';
import { roleName, roleNames } from '../src/game/names';

const rules = defaultRules();

describe('requirement names', () => {
  it('use each faction’s own building names', () => {
    expect(roleName(rules, 0, 'barracks')).toBe('Bunkhouse');
    expect(roleName(rules, 1, 'barracks')).toBe('spawn');
    expect(roleName(rules, 2, 'barracks')).toBe('Loft');
    expect(roleName(rules, 0, 'factory')).toBe('Motor Pool');
  });

  it('list several requirements readably', () => {
    expect(roleNames(rules, 0, ['factory', 'radar'])).toBe('Motor Pool and Radio Mast');
    expect(roleNames(rules, 2, ['tech'])).toBe('Conservatory');
  });
});
