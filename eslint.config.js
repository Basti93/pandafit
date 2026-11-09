import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['out', 'release', 'dist', 'node_modules', '.claude', '.worktrees', 'src/web/public'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  reactHooks.configs.flat.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      'no-empty': ['warn', { allowEmptyCatch: false }],
    },
  },
  // React Compiler oriented rules of react-hooks v7: they flag established patterns (latest-ref, Date.now in render, state from effects) all over the UI.
  // Kept as warnings until those patterns are reworked; rules-of-hooks and exhaustive-deps stay as they are.
  {
    rules: Object.fromEntries(
      ['refs', 'set-state-in-effect', 'purity', 'immutability', 'globals', 'use-memo', 'preserve-manual-memoization'].map((r) => [`react-hooks/${r}`, 'warn']),
    ),
  },
  // Node scripts in CommonJS.
  { files: ['**/*.cjs'], rules: { '@typescript-eslint/no-require-imports': 'off' } },
  // Tests build loose fakes and fixtures on purpose.
  { files: ['tests/**'], rules: { '@typescript-eslint/no-explicit-any': 'off' } },
);
