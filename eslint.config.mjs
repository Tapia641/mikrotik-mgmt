// ESLint 9 (flat config).
//
// `eslint-config-next/core-web-vitals` ya incluye la base de Next + el preset
// `next/typescript`, por lo que NO hay que volver a extender `eslint-config-next`
// (duplicaria plugins y reglas). A partir de Next 16 `next lint` fue eliminado:
// se usa el CLI de ESLint directamente (`npm run lint`).
//
// OJO: el preset de TS registra el plugin `@typescript-eslint` en un objeto con
// `files` restringido a TypeScript. Por eso las reglas que usan ese plugin deben
// ir en un objeto con el MISMO `files`; si no, ESLint intenta resolverlas tambien
// en los archivos de configuracion y falla con "could not find plugin".
//
// Nota: escribir globos dentro de comentarios de bloque es peligroso, porque la
// secuencia estrella-barra cierra el comentario antes de tiempo.

import next from 'eslint-config-next/core-web-vitals';

const TS_FILES = ['**/*.ts', '**/*.tsx'];

const config = [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'out/**',
      'data/**',
      'next-env.d.ts',
      // Configuracion del harness (no forma parte de la app).
      '.opencode/**',
    ],
  },
  ...next,
  {
    files: TS_FILES,
    rules: {
      // Los tipos de `src/types` son la fuente unica de verdad: prohibido `any` suelto.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    // Los scripts de CLI son la salida del programa: ahi `console.log` es correcto.
    files: ['scripts/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
];

export default config;
