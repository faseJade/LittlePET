import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

/**
 * Lint config.
 *
 * Two jobs. The first is ordinary: catch mistakes before TypeScript does. The
 * second is the interesting one - a few rules here duplicate promises the project
 * makes about itself (PLAN.md 0.3, 9.4) so a violation fails in seconds rather
 * than at the end of a test run. `tests/unit/enforcement.test.ts` asserts the same
 * properties independently; the two are deliberately not shared, because a guard
 * rail that only exists in one place is a guard rail that can be edited away.
 */
export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'release/**',
      'build/**',
      '.art/**',
      'node_modules/**',
      'src/sprites/cats/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.es2022 },
    },
    rules: {
      // Unused code is worse than verbose code: it reads as a decision someone
      // made, and a reader cannot tell it apart from a real one.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      // An empty catch swallows the one error that explains why a pet is broken.
      // `useUnknownInCatchVariables` means it has to be handled or re-thrown.
      'no-empty': ['error', { allowEmptyCatch: false }],
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
      'no-var': 'error',
      curly: ['error', 'multi-line'],
    },
  },

  // Main and preload run in Node with Electron's globals.
  {
    files: ['src/main/**/*.ts', 'src/preload/**/*.ts'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },

  // Renderers run in a browser, sandboxed, with no Node at all.
  {
    files: ['src/renderer/**/*.ts'],
    languageOptions: {
      globals: { ...globals.browser },
    },
    rules: {
      // The renderer takes its time from the injected clock so the simulation is
      // reproducible (PLAN.md 9.1). A stray wall-clock read makes every failure
      // unreproducible, which is the specific cost the injection seam avoids.
      'no-restricted-properties': [
        'error',
        {
          object: 'Date',
          property: 'now',
          message: 'Use ctx.time / ctx.dt instead (PLAN.md 9.1).',
        },
        {
          object: 'performance',
          property: 'now',
          message: 'Use ctx.time / ctx.dt instead (PLAN.md 9.1).',
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'setInterval', message: 'The renderer has no timers; use the injected clock.' },
        { name: 'setTimeout', message: 'The renderer has no timers; use the injected clock.' },
      ],
    },
  },

  // The app is offline. This is the same rule as enforcement test 1, and the
  // ALLOWLIST there is intentionally empty: needing the network is a decision
  // someone has to make out loud, in a commit, not a line someone deletes here.
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'LittlePET makes no network requests (PLAN.md 0.3).' },
        { name: 'XMLHttpRequest', message: 'LittlePET makes no network requests (PLAN.md 0.3).' },
        { name: 'WebSocket', message: 'LittlePET makes no network requests (PLAN.md 0.3).' },
        { name: 'EventSource', message: 'LittlePET makes no network requests (PLAN.md 0.3).' },
      ],
    },
  },

  {
    files: ['tests/**/*.ts'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      // Tests read source files as text on purpose, so they legitimately use
      // console and wall clocks when asserting the app does not.
      'no-console': 'off',
    },
  },

  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      'no-console': 'off',
    },
  },
);
