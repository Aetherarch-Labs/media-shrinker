/**
 * For Tool deployment (SITE_TYPE=app): replace index.html with app.html
 * so the root path serves the video compressor instead of the marketing page.
 * Netlify redirects can be unreliable for root path - this guarantees correct behavior.
 */
import { copyFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dist = join(__dirname, '..', 'dist');

if (process.env.SITE_TYPE === 'app') {
  const appHtml = join(dist, 'app.html');
  const indexHtml = join(dist, 'index.html');
  if (existsSync(appHtml)) {
    copyFileSync(appHtml, indexHtml);
    console.log('[postbuild] Tool site: root (/) now serves app');
  }
}
