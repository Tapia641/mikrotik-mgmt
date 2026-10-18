import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const src = fileURLToPath(new URL('./src', import.meta.url));

/**
 * Configuracion de tests (Vitest).
 *
 * Los tests cubren logica pura y persistencia (Node, sin DOM): servicios,
 * repositorios y utilidades. La verificacion de UI se hara con Playwright.
 *
 * Los alias replican los de `tsconfig.json`; el orden importa: las claves mas
 * especificas van antes que `@`.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@core': `${src}/core`,
      '@db': `${src}/database`,
      '@lib': `${src}/lib`,
      '@types': `${src}/types`,
      '@': src,
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/core/**', 'src/lib/**', 'src/database/**'],
      exclude: [
        'src/**/*.test.ts',
        'src/database/migrations/**',
        // Helper de tests, no codigo de produccion.
        'src/database/testing.ts',
      ],
    },
  },
});
