import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';
import hooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default defineConfig(
  globalIgnores([
    '**/dist/',
    '**/node_modules/',
    '**/coverage/',
    '**/test-results/',
    '**/playwright-report/',
    'apps/*/data/',
    'legacy/',
  ]),
  js.configs.recommended,
  tseslint.configs.recommended,
  { languageOptions: { globals: { ...globals.node, ...globals.browser } } },
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
    },
  },
  {
    files: ['**/*.tsx'],
    extends: [hooks.configs.flat['recommended-latest']],
  },
);
