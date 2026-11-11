// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://www.kanso.ar',
  // Mantiene las URLs iguales a Wix (/servicios, /bio, /eventosprivados) sin barra final
  trailingSlash: 'never',
  build: { format: 'file' },
  integrations: [sitemap()],
});
