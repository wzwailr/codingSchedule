import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
export default tseslint.config(
  { ignores: ['dist/**', 'release/**', '.artifacts/**', 'node_modules/**'] },
  js.configs.recommended, ...tseslint.configs.recommended,
  { languageOptions: { globals: { ...globals.node, ...globals.browser } }, rules: { '@typescript-eslint/no-explicit-any': 'error' } },
  { files: ['tests/fixtures/**/*.cjs'], rules: { '@typescript-eslint/no-require-imports': 'off' } },
);
