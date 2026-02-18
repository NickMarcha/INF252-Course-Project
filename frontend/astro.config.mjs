// @ts-check
import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';

// https://astro.build/config
export default defineConfig({
  site: 'https://NickMarcha.github.io',
  base: '/INF252-Course-Project/',
  integrations: [tailwind()],
  vite: {
    optimizeDeps: { include: ['leaflet'] },
    ssr: { external: ['leaflet'] },
  },
});
