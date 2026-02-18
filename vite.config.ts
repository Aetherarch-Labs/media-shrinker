import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

// Plugin to conditionally apply COEP headers only to app routes
const conditionalHeadersPlugin = {
  name: 'conditional-headers',
  configureServer(server) {
    // Use early middleware to catch all requests including workers
    server.middlewares.use((req, res, next) => {
      const url = req.url || '';
      const referer = req.headers.referer || '';
      
      // Check if this is a request from the app context
      const isAppPage = url === '/app.html' || url.startsWith('/app') || url === '/pro.html' || url.startsWith('/pro');
      const isAppResource = referer.includes('/app') || referer.includes('/pro') ||
                           url.includes('?worker') || 
                           url.includes('worker.js') ||
                           url.includes('/src/') && referer.includes('/app');
      
      if (isAppPage || isAppResource) {
        res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
        res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
        // Set CORP header for same-origin resources to allow embedding
        // This is required for COEP: require-corp to work with workers and other resources
        if (!url.startsWith('http') && !url.startsWith('//')) {
          res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        }
      }
      next();
    });
  },
};

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), conditionalHeadersPlugin],
  // Optimize deps to prevent Vite from choking on the massive Wasm dependency graph
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        app: resolve(__dirname, 'app.html'),
        pro: resolve(__dirname, 'pro.html'),
      },
    },
  },
});
