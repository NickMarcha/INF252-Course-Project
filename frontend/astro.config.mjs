// @ts-check
import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import wasm from 'vite-plugin-wasm';

// https://astro.build/config
export default defineConfig({
  site: 'https://NickMarcha.github.io',
  base: '/INF252-Course-Project/',
  integrations: [tailwind()],
  vite: {
    plugins: [wasm()],
    optimizeDeps: {
      include: ['leaflet', 'leaflet-polylinedecorator'],
      exclude: ['parquet-wasm'],
    },
    ssr: { external: ['leaflet', 'leaflet-polylinedecorator'] },
  },
});
