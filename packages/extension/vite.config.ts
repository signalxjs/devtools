import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { copyFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';

/**
 * Multi-entry build for the Chrome MV3 extension.
 *
 * Three independent bundles ship in `dist/`:
 *   - panel/index.js      (loaded by panel.html, the devtools panel UI)
 *   - devtools/index.js   (loaded by devtools.html, registers the panel)
 *   - content-script.js   (injected by Chrome into matched pages)
 *   - service-worker.js   (MV3 background)
 *
 * Each entry is built as an IIFE-free ESM module. The panel and devtools
 * HTML files are emitted via Vite's HTML entry mechanism; the
 * content-script and service-worker are emitted as raw JS modules.
 *
 * The manifest.json is copied as a static asset from `public/`.
 */
export default defineConfig({
    build: {
        outDir: 'dist',
        emptyOutDir: true,
        // No minification by default — easier to debug an unpacked extension.
        // The user can flip this on once the build is stable.
        minify: false,
        rollupOptions: {
            input: {
                panel: resolve(__dirname, 'panel.html'),
                devtools: resolve(__dirname, 'devtools.html'),
                'content-script': resolve(__dirname, 'src/content-script/content-script.ts'),
                'service-worker': resolve(__dirname, 'src/background/service-worker.ts'),
            },
            output: {
                // Flatten file names so the manifest can reference them
                // without subdirectories (Chrome doesn't care, but a
                // stable layout makes debugging easier).
                entryFileNames: chunk => {
                    if (chunk.name === 'content-script') return 'content-script.js';
                    if (chunk.name === 'service-worker') return 'service-worker.js';
                    return 'assets/[name]-[hash].js';
                },
                chunkFileNames: 'assets/[name]-[hash].js',
                assetFileNames: 'assets/[name]-[hash][extname]',
            },
        },
    },
    esbuild: {
        jsx: 'automatic',
        jsxImportSource: 'sigx',
    },
    plugins: [
        {
            // Copies everything under public/ to dist/ (manifest.json,
            // icon.png, etc.). Vite's default publicDir handling skips
            // these in some multi-entry configs, so we mirror the
            // directory explicitly.
            name: 'copy-public',
            closeBundle() {
                const src = resolve(__dirname, 'public');
                const dst = resolve(__dirname, 'dist');
                mkdirSync(dst, { recursive: true });
                for (const name of readdirSync(src)) {
                    const from = resolve(src, name);
                    if (!statSync(from).isFile()) continue;
                    copyFileSync(from, resolve(dst, name));
                }
            },
        },
    ],
});
