import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'examples/demo-vault/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Unused args are often part of a documented signature (hook payloads,
      // injected deps). Allow a leading underscore to say "deliberately unused".
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': 'off',
    },
  },
  {
    // The Workers read globals that eslint's browser/node sets don't cover.
    files: ['packages/*-worker/**/*.ts', 'packages/vault-bridge/**/*.ts'],
    languageOptions: {
      globals: { Response: 'readonly', Request: 'readonly', crypto: 'readonly', fetch: 'readonly' },
    },
  },
);
