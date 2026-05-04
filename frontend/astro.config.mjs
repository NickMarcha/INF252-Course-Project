// @ts-check
import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import wasm from 'vite-plugin-wasm';

/** Same string as `base` — used so dev can redirect root `/favicon.ico` probes to the real asset. */
const BASE = '/INF252-Course-Project/';

// https://astro.build/config
export default defineConfig({
  site: 'https://NickMarcha.github.io',
  base: BASE,
  integrations: [tailwind()],
  vite: {
    plugins: [
      {
        name: 'favicon-ico-root-redirect',
        enforce: 'pre',
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            const path = req.url?.split('?')[0] ?? '';
            if (path === '/favicon.ico') {
              res.statusCode = 302;
              res.setHeader('Location', `${BASE}favicon.svg`);
              res.end();
              return;
            }
            next();
          });
        },
      },
      wasm(),
    ],
    optimizeDeps: {
      include: ['leaflet', 'leaflet-polylinedecorator'],
      exclude: ['parquet-wasm'],
      // Pre-bundled deps often ship incomplete source maps → Firefox "No sources are declared" noise.
      esbuildOptions: { sourcemap: false },
    },
    ssr: { external: ['leaflet', 'leaflet-polylinedecorator'] },
  },
});
