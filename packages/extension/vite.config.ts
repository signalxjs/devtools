import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { copyFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';

/**
 * Multi-entry build for the Chrome MV3 extension.
 *
 * Bundles emitted into `dist/`:
 *   - assets/panel-*.js     (loaded by panel.html, the devtools panel UI)
 *   - assets/devtools-*.js  (loaded by devtools.html, registers the panel)
 *   - content-script.js     (injected into matched pages)
 *   - service-worker.js     (MV3 background)
 *
 * Each entry is built as an IIFE-free ESM module. The panel and devtools
 * HTML files are emitted via Vite's HTML entry mechanism; the
 * content-script and service-worker are emitted as raw JS modules.
 *
 * The manifest and icons are copied as static assets from `public/`.
 *
 * Mode-aware:
 *   - `vite build` (default mode = production) → minified, with .map files.
 *   - `vite build --mode development` → unminified, faster watch iteration.
 */
export default defineConfig(({ mode }) => ({
    build: {
        outDir: 'dist',
        emptyOutDir: true,
        // Minify in production for the store upload; leave dev unminified
        // so iteration is fast and stack traces stay readable without a
        // sourcemap round-trip. Source maps ship in both modes — Chrome
        // Web Store reviewers (and anyone debugging via devtools-on-
        // devtools) need them, and they're not loaded by end users.
        minify: mode === 'production' ? 'esbuild' : false,
        sourcemap: true,
        rollupOptions: {
            input: {
                panel: resolve(__dirname, 'panel.html'),
                devtools: resolve(__dirname, 'devtools.html'),
                'content-script': resolve(__dirname, 'src/content-script/content-script.ts'),
                'service-worker': resolve(__dirname, 'src/background/service-worker.ts'),
            },
            output: {
                // Flat top-level names for the two scripts the manifest
                // references directly. Everything else goes under
                // assets/ with content-hashed names.
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
            // icon.png, icon-{16,32,48,128}.png). Vite's default
            // publicDir handling skips these in some multi-entry
            // configs, so we mirror the directory explicitly.
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
}));
