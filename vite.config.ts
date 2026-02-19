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
        about: resolve(__dirname, 'about.html'),
        contact: resolve(__dirname, 'contact.html'),
        privacy: resolve(__dirname, 'privacy.html'),
        'blog/index': resolve(__dirname, 'blog/index.html'),
        'blog/how-to-send-large-videos-discord': resolve(__dirname, 'blog/how-to-send-large-videos-discord.html'),
        'blog/whatsapp-status-export-settings': resolve(__dirname, 'blog/whatsapp-status-export-settings.html'),
        'blog/webm-vs-mp4-size': resolve(__dirname, 'blog/webm-vs-mp4-size.html'),
        'blog/bypass-25mb-email-limit': resolve(__dirname, 'blog/bypass-25mb-email-limit.html'),
        'blog/is-online-video-compression-safe': resolve(__dirname, 'blog/is-online-video-compression-safe.html'),
        'blog/discord-nitro-file-limits': resolve(__dirname, 'blog/discord-nitro-file-limits.html'),
        'blog/video-compression-basics': resolve(__dirname, 'blog/video-compression-basics.html'),
        'blog/h264-vs-h265-guide': resolve(__dirname, 'blog/h264-vs-h265-guide.html'),
        'blog/compress-videos-social-media': resolve(__dirname, 'blog/compress-videos-social-media.html'),
        'blog/understanding-video-file-sizes': resolve(__dirname, 'blog/understanding-video-file-sizes.html'),
      },
    },
  },
});
