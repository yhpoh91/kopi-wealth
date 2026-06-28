import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';

function htmlTextPlugin(): Plugin {
  return {
    name: 'html-as-text',
    transform(_, id) {
      if (id.endsWith('.html')) {
        const content = readFileSync(id, 'utf8');
        return `export default ${JSON.stringify(content)}`;
      }
    },
  };
}

export default defineConfig({
  plugins: [htmlTextPlugin()],
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
