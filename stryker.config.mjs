export default {
  clearTextReporter: { maxTestsToLog: 1, reportTests: false, skipFull: true },
  concurrency: '50%',
  // TypeScript 7's native-preview package doesn't expose the compiler API
  // Stryker uses to rewrite tsconfig files inside a sandbox. In-place mode
  // avoids that rewrite; Stryker backs up and restores every mutated file.
  inPlace: true,
  incremental: true,
  // Static mutants run at module load rather than inside one test, so
  // Stryker can't scope them with perTest coverage and reruns every test for
  // each one. See docs/runbook.md "Mutation testing" for the trade-off.
  ignoreStatic: true,
  // Keep the full audit focused on business policy and Activities. Runtime
  // adapters and transitional forever-tasks are validated by focused tests.
  mutate: [
    'src/bot/activities/**/*.ts',
    'src/bot/orchestration/**/*.ts',
    'src/bot/combat.ts',
    'src/bot/gear.ts',
    'src/bot/inventory.ts',
    'src/bot/materialPlan.ts',
    'src/bot/progression.ts',
    'src/bot/world.ts',
    'src/bot/xpRates.ts',
  ],
  plugins: ['@stryker-mutator/vitest-runner'],
  reporters: ['clear-text', 'progress', 'html'],
  testRunner: 'vitest',
  thresholds: { break: null, high: 80, low: 50 },
};
