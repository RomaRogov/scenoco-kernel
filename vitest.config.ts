import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const src = (path: string) => fileURLToPath(new URL(`./src/${path}`, import.meta.url));

export default defineConfig({
  resolve: {
    // The tests import the package by its name; the more specific path first.
    alias: [
      { find: '@scenoco/kernel/internal', replacement: src('internal.ts') },
      { find: '@scenoco/kernel', replacement: src('index.ts') },
    ],
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
