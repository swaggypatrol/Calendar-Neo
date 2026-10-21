import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) =>
  mode === 'demo'
    ? {
        base: './',
        build: { outDir: 'demo-dist', rollupOptions: { input: ['index.html', 'booking.html', 'retro.html'] } },
      }
    : mode === 'parts'
    ? {
        // The two halves on their own (ES modules): dist/single.js (the calculator) and dist/multi.js (the highlighter)
        build: {
          emptyOutDir: false,
          lib: {
            entry: { single: 'src/single/index.ts', multi: 'src/multi/index.ts' },
            formats: ['es'],
            fileName: (_format, name) => `${name}.js`,
          },
        },
      }
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
