import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) =>
  mode === 'demo'
    ? { base: './', build: { outDir: 'demo-dist' } }
    : {
        build: {
          lib: {
            entry: 'src/index.ts',
            name: 'HighlighterCalendar',
            formats: ['es', 'umd'],
            fileName: (format) =>
              format === 'es' ? 'highlighter-calendar.js' : 'highlighter-calendar.umd.cjs',
          },
        },
        test: { environment: 'node' },
      },
);
