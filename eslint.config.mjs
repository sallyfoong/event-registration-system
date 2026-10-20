import eslint from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/node_modules/', '**/dist/', '**/build/', '**/coverage/', '**/data/'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['server/src/**/*.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['client/src/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // pages export a component plus small local helpers in a few places;
      // the rule fights that layout without catching real bugs here
      'react-refresh/only-export-components': 'off',
    },
  },
  {
    // build/tooling configs and the screenshot script are CommonJS and run
    // in node
    files: ['**/*.cjs', '**/*.config.{js,mjs,ts}', 'screenshots/*.js'],
    languageOptions: {
      globals: { ...globals.node },
      sourceType: 'commonjs',
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    // E2E: the specs run in node but their `page.evaluate` callbacks are
    // serialised into the browser, so both global sets are legitimate here.
    files: ['e2e/**/*.{ts,mjs,js}'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },
  {
    // test files reach for `any` when stubbing Sequelize models, which is
    // the point of the stub
    files: ['**/tests/**/*.{ts,tsx}', '**/*.test.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
);
