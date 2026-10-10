import tseslint from 'typescript-eslint';
import globals from 'globals';

// Determinism ban list for code that runs inside the lockstep simulation.
// Everything here must produce bit-identical results on every JS engine, so:
// no randomness, no clocks, no float math functions, no unordered iteration,
// and no `/` (use idiv/fx helpers from packages/sim/src/fx.ts).
const FLOAT_MATH = [
  'random', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'sinh', 'cosh', 'tanh',
  'asinh', 'acosh', 'atanh', 'sqrt', 'cbrt', 'pow', 'exp', 'expm1', 'log', 'log2', 'log10',
  'log1p', 'hypot', 'fround', 'round', 'floor', 'ceil', 'trunc',
];

export const deterministicRules = {
  'no-restricted-properties': [
    'error',
    ...FLOAT_MATH.map((property) => ({
      object: 'Math',
      property,
      message: 'Non-deterministic or float math is banned in the sim. Use fx.ts helpers.',
    })),
    { object: 'Date', property: 'now', message: 'Clocks are banned in the sim.' },
    { object: 'performance', property: 'now', message: 'Clocks are banned in the sim.' },
    { object: 'Object', property: 'keys', message: 'Unordered key iteration is banned in the sim. Use arrays or Map.' },
    { object: 'Object', property: 'values', message: 'Unordered key iteration is banned in the sim. Use arrays or Map.' },
    { object: 'Object', property: 'entries', message: 'Unordered key iteration is banned in the sim. Use arrays or Map.' },
    { object: 'Number', property: 'parseFloat', message: 'Floats are banned in the sim.' },
  ],
  'no-restricted-globals': [
    'error',
    ...['Date', 'performance', 'setTimeout', 'setInterval', 'crypto', 'requestAnimationFrame', 'parseFloat', 'window', 'document', 'self'].map(
      (name) => ({ name, message: `${name} is banned in the sim (determinism / no I/O).` }),
    ),
  ],
  'no-restricted-syntax': [
    'error',
    { selector: 'ForInStatement', message: 'for…in is banned in the sim (unordered iteration).' },
    { selector: 'Literal[raw=/^\\d*\\.\\d/]', message: 'Float literals are banned in the sim. Use Q10 fixed point.' },
    { selector: 'Literal[raw=/[eE]-/]', message: 'Float literals are banned in the sim. Use Q10 fixed point.' },
    { selector: "BinaryExpression[operator='/']", message: 'Division is banned in the sim. Use idiv()/fdiv() from fx.ts.' },
    { selector: "AssignmentExpression[operator='/=']", message: 'Division is banned in the sim. Use idiv()/fdiv() from fx.ts.' },
    { selector: "BinaryExpression[operator='**']", message: 'Exponentiation is banned in the sim.' },
  ],
};

export const DETERMINISTIC_FILES = ['packages/sim/src/**/*.ts', 'packages/mapgen/src/**/*.ts', 'packages/ai/src/**/*.ts'];

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/test-results/**', '**/playwright-report/**', 'supabase/functions/**'],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    files: ['**/*.js', 'tools/**/*.ts', 'apps/headless/**/*.ts', '**/vitest.config.ts', '**/vite.config.ts', '**/playwright.config.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    files: DETERMINISTIC_FILES,
    rules: deterministicRules,
  },
);
