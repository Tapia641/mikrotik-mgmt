/**
 * Tailwind CSS v4 se integra a traves de su plugin PostCSS oficial.
 * El tema y los tokens viven en `src/app/globals.css` (directiva `@theme`),
 * por lo que no se requiere `tailwind.config.ts`.
 */
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};

export default config;
