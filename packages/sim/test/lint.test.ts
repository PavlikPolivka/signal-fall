import { ESLint } from 'eslint';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Proves every determinism rule fires for sim code (and not for client code).
const root = fileURLToPath(new URL('../../..', import.meta.url));
const eslint = new ESLint({ cwd: root });

async function ruleHits(code: string, file = 'packages/sim/src/__fixture__.ts'): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: `${root}${file}` });
  return result!.messages.map((m) => m.ruleId ?? 'parse-error');
}

const banned: [string, string][] = [
  ['Math.random()', 'no-restricted-properties'],
  ['Math.sin(1)', 'no-restricted-properties'],
  ['Math.sqrt(2)', 'no-restricted-properties'],
  ['Math.floor(2)', 'no-restricted-properties'],
  ['Date.now()', 'no-restricted-properties'],
  ['new Date()', 'no-restricted-globals'],
  ['performance.now()', 'no-restricted-globals'],
  ['Object.keys({})', 'no-restricted-properties'],
  ['for (const k in {}) void k', 'no-restricted-syntax'],
  ['const x = 1.5; void x', 'no-restricted-syntax'],
  ['const x = 3 / 2; void x', 'no-restricted-syntax'],
  ['let x = 3; x /= 2', 'no-restricted-syntax'],
  ['const x = 2 ** 3; void x', 'no-restricted-syntax'],
];

describe('sim determinism lint rules', () => {
  it.each(banned)('flags %s', async (code, rule) => {
    expect(await ruleHits(code)).toContain(rule);
  });

  it('allows integer math helpers', async () => {
    expect(await ruleHits('const x = Math.imul(3, 4) + Math.abs(-2) + Math.min(1, 2) + (7 >> 1); void x')).toEqual([]);
  });

  it('does not apply to client code', async () => {
    expect(await ruleHits('const x = Math.random() / 2; void x', 'apps/client/src/__fixture__.ts')).toEqual([]);
  });

  it('applies to mapgen and ai too', async () => {
    expect(await ruleHits('Math.random()', 'packages/mapgen/src/__fixture__.ts')).toContain('no-restricted-properties');
    expect(await ruleHits('Math.random()', 'packages/ai/src/__fixture__.ts')).toContain('no-restricted-properties');
  });
});
