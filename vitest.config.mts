import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

/**
 * Unit tests cover the DOM-free half of the app: the sampler, the animation clock,
 * the behavior machine, the mochi springs, the sprite compiler and the click-through
 * hit test. None of that needs Electron or a display, which is the payoff of
 * putting the logic behind an injected clock (PLAN.md 9.1).
 *
 * Integration tests (window geometry, click-through toggling, tray) run under
 * Playwright `_electron` and are excluded here because they need a real display.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(import.meta.dirname, 'src/shared'),
      '@sprites': resolve(import.meta.dirname, 'src/sprites'),
    },
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    // Golden-image tests are slow and produce large diffs on failure.
    testTimeout: 20_000,
  },
});
