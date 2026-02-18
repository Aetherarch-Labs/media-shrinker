import { copyFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const src = join(root, 'node_modules', '@ffmpeg', 'core-mt', 'dist', 'esm');
const dest = join(root, 'public', 'ffmpeg');

const files = ['ffmpeg-core.js', 'ffmpeg-core.wasm', 'ffmpeg-core.worker.js'];

if (!existsSync(src)) {
  console.warn('[copy-ffmpeg] @ffmpeg/core-mt not found, skipping. Run: npm install');
  process.exit(0);
}

mkdirSync(dest, { recursive: true });
for (const f of files) {
  copyFileSync(join(src, f), join(dest, f));
}
console.log('[copy-ffmpeg] Copied FFmpeg core files to public/ffmpeg/');
