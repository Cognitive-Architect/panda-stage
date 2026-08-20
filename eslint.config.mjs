import eslint from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'dist-electron/**',
      'node_modules/**',
      // This is an exact pinned upstream parser closure. TypeScript build
      // compatibility is handled at the adapter boundary; linting it would
      // turn an upstream byte-for-byte import into a local rewrite.
      'src/renderer/fla-import/parser-core/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    files: [
      'src/main/**/*.ts',
      'src/preload/**/*.ts',
      'scripts/**/*.cjs',
      'tests/helpers/**/*.cjs',
      '*.config.ts',
    ],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ['scripts/**/*.cjs'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    // RH-06: production code must use the formal src/domain model and must not
    // newly depend on the legacy compatibility model at src/shared/domain.
    // Legacy/historical/test consumers (tests/unit/*, scripts/verify-day04.cjs)
    // are out of scope because they are not matched by these production globs.
    files: [
      'src/main/**/*.{ts,tsx}',
      'src/preload/**/*.{ts,tsx}',
      'src/renderer/**/*.{ts,tsx}',
      'src/domain/**/*.{ts,tsx}',
      'src/history/**/*.{ts,tsx}',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/shared/domain', '**/shared/domain/**'],
              message:
                'RH-06: src/shared/domain is legacy compatibility-only. Import the formal domain model from src/domain instead.',
            },
          ],
        },
      ],
    },
  },
);
