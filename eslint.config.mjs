// ESLint（flat config）：不读类型的推荐集 —— @eslint/js + typescript-eslint + eslint-plugin-vue；
// eslint-config-prettier 放最后，关掉与 Prettier 冲突的格式类规则（格式只归 Prettier 管）
import js from '@eslint/js'
import prettier from 'eslint-config-prettier'
import vue from 'eslint-plugin-vue'
import { defineConfig, globalIgnores } from 'eslint/config'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default defineConfig([
  globalIgnores(['out/', 'dist/', 'docs/']),
  js.configs.recommended,
  tseslint.configs.recommended,
  vue.configs['flat/recommended'],
  {
    // .vue 的 <script lang="ts"> 交给 typescript-eslint 的解析器
    files: ['**/*.vue'],
    languageOptions: { parserOptions: { parser: tseslint.parser } },
  },
  {
    // 截图脚本是 Electron 直接加载的 CommonJS
    files: ['**/*.cjs'],
    languageOptions: { sourceType: 'commonjs' },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      // `_` 开头的变量与解构剔除（`const { hint: _hint, ...rest } = x`）是有意不用的
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  {
    // 模板属性里的全角空格（U+3000）是原型文案（左栏搜索框的占位），不当成误输入
    files: ['**/*.vue'],
    rules: {
      'no-irregular-whitespace': 'off',
      'vue/no-irregular-whitespace': ['error', { skipHTMLAttributeValues: true }],
    },
  },
  prettier,
])
