import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['node_modules/**', '.next/**', 'coverage/**', 'tests/fixtures/**', 'next-env.d.ts'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['src/**/*.tsx'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    // Principle III: the gate is a pure function over a file list. It may not
    // reach the network, the container runtime, or the filesystem. Enforced by
    // this rule, not merely intended (T098).
    files: ['src/lib/policy/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            'dockerode',
            'octokit',
            '@octokit/rest',
            'simple-git',
            'nodemailer',
            'fs',
            'node:fs',
            'node:fs/promises',
            'child_process',
            'node:child_process',
            'node:net',
            'node:http',
            'node:https',
          ],
          patterns: ['@/lib/github/*', '@/lib/netlify/*', '@/lib/runner/*', '@/lib/mirror/*'],
        },
      ],
    },
  },
);
