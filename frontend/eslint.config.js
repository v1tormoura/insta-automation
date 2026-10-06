import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['vite.config.js'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      /* Estas quatro regras do react-hooks 7 existem para o React Compiler,
         que o projeto não usa. Elas condenam padrões que aqui são de propósito
         e funcionam: carregar dados num efeito (`useEffect(() => { load() })`),
         guardar o callback mais recente numa ref, `Date.now()` para "há 3 min".
         As regras que pegam bug de verdade continuam: rules-of-hooks (erro) e
         exhaustive-deps (aviso). */
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/preserve-manual-memoization': 'off',
      /* Só afeta o recarregamento rápido em desenvolvimento (o arquivo que
         exporta componente + função recarrega a página inteira); nada muda no
         site publicado. */
      'react-refresh/only-export-components': 'off',
    },
  },
])
