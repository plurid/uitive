import { defineConfig } from 'vitest/config';
import { aptuitive } from '../vite/aptuitive.ts';

// Tests run against package source, like the apps do in development.
export default defineConfig({
  plugins: [aptuitive()],
  test: {
    environment: 'node',
    root: new URL('../../', import.meta.url).pathname,
    include: [
      'packages/*/src/**/*.test.{ts,tsx}',
      'apps/*/src/**/*.test.{ts,tsx}',
      'tools/tests/*.test.{ts,tsx}',
      'docs/examples/**/*.test.{ts,tsx}',
    ],
  },
});
