import js from '@eslint/js'
import globals from 'globals'
import reactPlugin from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import prettierConfig from 'eslint-config-prettier'

export default [
  // ── Fichiers ignorés ──
  { ignores: ['dist/', 'node_modules/', 'public/', '*.config.js'] },

  // ── Config de base JS ──
  js.configs.recommended,

  // ── React : détecte que <Foo /> utilise la variable Foo ──
  reactPlugin.configs.flat.recommended,
  reactPlugin.configs.flat['jsx-runtime'],

  // ── Config React + Hooks ──
  {
    files: ['src/**/*.{js,jsx}'],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.es2021,
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    settings: {
      react: { version: 'detect' },
    },
    rules: {
      // ── React ──
      'react/react-in-jsx-scope': 'off',        // React 18 n'a plus besoin de l'import
      'react/prop-types': 'off',                 // Pas de PropTypes (futur TypeScript)
      'react/jsx-no-target-blank': 'warn',       // Sécurité: rel="noopener"
      'react/no-unescaped-entities': 'warn',     // Entités HTML dans JSX

      // ── React Hooks ──
      'react-hooks/rules-of-hooks': 'error',     // Règles des hooks obligatoires
      'react-hooks/exhaustive-deps': 'warn',     // Dépendances useEffect/useMemo

      // ── React Refresh (Vite HMR) ──
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],

      // ── Qualité JS ──
      'no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',                  // Autorise _unused
        varsIgnorePattern: '^_',
        destructuredArrayIgnorePattern: '^_',
      }],
      'no-console': ['warn', {
        allow: ['warn', 'error'],                 // console.log → warning
      }],
      'no-debugger': 'error',                     // Pas de debugger en prod
      'no-duplicate-imports': 'error',            // Imports dupliqués interdits
      'no-var': 'error',                          // const/let uniquement
      'prefer-const': 'warn',                     // const quand pas de réassignation
      'eqeqeq': ['error', 'always', { null: 'ignore' }], // === obligatoire, sauf == null (idiome JS)
      'no-implicit-coercion': 'warn',             // Pas de !!x, +x, etc.
      'curly': ['warn', 'multi-line'],            // Accolades pour les blocs multi-lignes
    },
  },

  // ── Désactive les règles de formatage (Prettier gère) ──
  prettierConfig,
]
