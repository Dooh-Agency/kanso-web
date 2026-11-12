// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://www.kanso.ar',
  // Mantiene las URLs iguales a Wix (/servicios, /bio) sin barra final
  trailingSlash: 'never',
  build: { format: 'file' },
  integrations: [
    // El planificador es una herramienta interna: fuera del sitemap.
    sitemap({ filter: (page) => !page.includes('/planificador-redes') }),
    react(),
  ],
  // Tailwind solo lo usa el planificador (src/styles/planner.css).
  vite: { plugins: [tailwindcss()] },
});
