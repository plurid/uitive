import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { uitive } from '../vite/uitive.ts';

// Tests run against package source, like the apps do in development.
export default defineConfig({
  plugins: [uitive()],
  test: {
    environment: 'node',
    root: fileURLToPath(new URL('../../', import.meta.url)),
    include: [
      'packages/*/src/**/*.test.{ts,tsx}',
      'apps/*/src/**/*.test.{ts,tsx}',
      'tools/tests/*.test.{ts,tsx}',
      'docs/examples/**/*.test.{ts,tsx}',
    ],
  },
});
