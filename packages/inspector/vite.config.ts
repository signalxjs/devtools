import { defineConfig } from 'vite';
import { resolve } from 'node:path';

/**
 * Vite build for the standalone panel. Outputs to `dist-panel/`; the
 * Node relay server (compiled from `server/` to `dist-server/`) serves
 * those files when a browser hits the inspector's HTTP port.
 */
export default defineConfig({
    build: {
        outDir: 'dist-panel',
        emptyOutDir: true,
        minify: false,
        rollupOptions: {
            input: {
                panel: resolve(__dirname, 'panel.html'),
            },
        },
    },
    esbuild: {
        jsx: 'automatic',
        jsxImportSource: 'sigx',
    },
});
