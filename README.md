# Media Shrinker

A client-side video compression tool built with React, Vite, TypeScript, and FFmpeg.wasm. Compress your videos directly in the browser without uploading to any server.

## Features

- 🎥 **Client-Side Processing**: All compression happens in your browser - your files never leave your device
- 🔒 **Privacy-First**: No server uploads, no data collection
- ⚡ **Fast**: Multi-threaded FFmpeg.wasm for efficient processing
- 🎨 **Modern UI**: Beautiful, responsive interface built with Tailwind CSS
- 📦 **Customizable**: Set your target file size (8MB, 25MB, 50MB, 100MB presets or custom)

## Tech Stack

- **React 18+** - UI framework
- **TypeScript** - Type safety
- **Vite 5+** - Build tool and dev server
- **Tailwind CSS** - Styling
- **FFmpeg.wasm v0.12.x** - Video processing engine
- **react-dropzone** - File upload interface

## Getting Started

### Prerequisites

- Node.js 18+ and npm installed
- A modern browser that supports SharedArrayBuffer (Chrome, Edge, Firefox)

### Installation

Dependencies are already installed. If you need to reinstall:

```bash
npm install
```

### Development

Start the development server:

```bash
npm run dev
```

The app will be available at `http://localhost:5173` (or the next available port).

### Building for Production

```bash
npm run build
```

The production build will be in the `dist` folder.

### Preview Production Build

```bash
npm run preview
```

## How to Use

1. **Start the dev server**: Run `npm run dev`
2. **Open your browser**: Navigate to the URL shown (usually `http://localhost:5173`)
3. **Wait for FFmpeg to load**: You'll see a yellow banner while the FFmpeg engine loads (first time may take 30-60 seconds)
4. **Select a video**: Drag and drop a video file or click to browse
5. **Set target size**: Choose a preset (8MB, 25MB, etc.) or enter a custom size
6. **Compress**: Click "Compress Video" and wait for processing
7. **Download**: Once complete, download your compressed video

## Browser Compatibility

### ✅ Supported Browsers

- **Chrome/Edge 92+** - Full support
- **Firefox 89+** - Full support
- **Safari 15.4+** - Full support (desktop)

### ⚠️ Limitations

- **Mobile Safari**: May have memory limitations for large videos
- **Older browsers**: SharedArrayBuffer not supported

## Deployment (Netlify) — Dual-Deploy from One Repo

AdSense and the video compressor have conflicting header requirements. This repo uses **branch deploys** so both sites deploy from the same codebase:

| Branch | Netlify Site | Domain | Headers |
|--------|--------------|--------|---------|
| `main` | Marketing | `mediashrinker.aetherarchlabs.xyz` | No COEP/COOP (AdSense) |
| `app` | Tool | `mediashrinkerapp.aetherarchlabs.xyz` | COEP/COOP (FFmpeg) |

### One-Time Setup

1. **Create the app branch** (run once):
   ```bash
   # Windows (PowerShell)
   .\scripts\setup-app-branch.ps1

   # macOS/Linux
   ./scripts/setup-app-branch.sh
   ```

2. **Push both branches**:
   ```bash
   git push origin main
   git push -u origin app
   ```

3. **Create two Netlify sites** (both from `Aetherarch-Labs/video-shrinker`):
   - **Marketing**: Branch = `main`, Domain = mediashrinker.aetherarchlabs.xyz
   - **Tool**: Branch = `app`, Domain = mediashrinkerapp.aetherarchlabs.xyz

4. **DNS** (at your registrar or Netlify DNS for aetherarchlabs.xyz):
   - CNAME `mediashrinkerapp` → Tool Netlify site
   - CNAME `mediashrinker` → Marketing Netlify site

### Config Files

- `netlify.toml` — Active config (Marketing on main, Tool on app)
- `netlify.marketing.toml` — Marketing config (no COEP)
- `netlify.tool.toml` — Tool config (COEP/COOP)

### Merging app → main

When merging the app branch into main, keep main's `netlify.toml` (marketing config). Run once:

```bash
git config merge.ours.driver true
```

The `.gitattributes` file ensures `netlify.toml` keeps main's version on merge.

### First-Time Repo Setup

If the project isn't a git repo yet:

```bash
git init
git add .
git commit -m "Initial commit: dual-deploy setup"
git branch -M main
git remote add origin git@github.com:Aetherarch-Labs/video-shrinker.git
git push -u origin main
```

Then run the setup script and push the app branch.

## Important Notes

### Cross-Origin Isolation

This app requires Cross-Origin Isolation headers to enable SharedArrayBuffer (needed for multi-threading). The Vite dev server is configured with:

- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: require-corp`

These headers are automatically set in development. For production, deploy the Tool (app subdomain) separately from the Marketing site so each has the correct headers.

### File Size Recommendations

- **Small videos** (< 100MB): Should work well
- **Medium videos** (100MB - 500MB): May take several minutes
- **Large videos** (> 500MB): May hit browser memory limits

### Performance Tips

- Use shorter videos for faster processing
- Close other browser tabs to free up memory
- Be patient - compression is CPU-intensive

## Troubleshooting

### "SharedArrayBuffer is not defined" Error

- Make sure you're accessing the app via `localhost` or `127.0.0.1` (not `file://`)
- Check that your browser supports SharedArrayBuffer
- Try a different browser if issues persist

### FFmpeg Fails to Load

- Ensure `public/ffmpeg/` contains core files (run `npm run copy:ffmpeg` before build)
- Try refreshing the page
- Check browser console for detailed error messages

### Video Processing Fails

- Ensure the video file is a supported format (MP4, MOV, AVI, MKV, WebM, etc.)
- Try a smaller video file first
- Check that the target size is reasonable for the video duration

## Project Structure

```
MediaShrinker/
├── src/
│   ├── components/       # UI components
│   │   ├── FileDropzone.tsx
│   │   ├── Progress.tsx
│   │   └── SettingsPanel.tsx
│   ├── hooks/            # Custom React hooks
│   │   └── useTranscoder.ts
│   ├── lib/              # Utility functions
│   │   └── utils.ts
│   ├── App.tsx           # Main app component
│   ├── main.tsx          # React entry point
│   └── index.css         # Tailwind imports
├── vite.config.ts        # Vite configuration
├── tailwind.config.js    # Tailwind configuration
└── package.json          # Dependencies
```

## License

MIT
