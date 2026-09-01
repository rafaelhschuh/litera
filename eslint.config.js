import js from '@eslint/js'
import vue from 'eslint-plugin-vue'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**', 'src/legacy/**', 'test-results/**', 'playwright-report/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...vue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: { parser: tseslint.parser },
      globals: { window: 'readonly', document: 'readonly', requestAnimationFrame: 'readonly', HTMLElement: 'readonly', HTMLInputElement: 'readonly', HTMLCanvasElement: 'readonly' },
    },
    rules: {
      'vue/multi-word-component-names': 'off',
      'vue/max-attributes-per-line': 'off',
      'vue/singleline-html-element-content-newline': 'off',
      'vue/html-self-closing': 'off',
      'vue/require-default-prop': 'off',
    },
  },
  { rules: { '@typescript-eslint/no-explicit-any': 'off', '@typescript-eslint/no-namespace': 'off', '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }] } },
)
