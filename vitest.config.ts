import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: ['node_modules/**', '.claude/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      exclude: [
        'src/templates/**',
        'src/types/**',
        'src/lib/ddb.ts',
        'src/lib/auth.ts',
        'src/lib/secrets.ts',
        'src/migrations/**',
        'src/migrate.ts',
        'node_modules/**',
        'dist/**',
        'vitest.config.ts',
        'test/**',
        '.claude/**',
        'coverage/**',
      ],
      thresholds: {
        lines: 95,
        functions: 95,
        branches: 95,
      },
    },
  },
});
