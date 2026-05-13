/**
 * SignalX DevTools inspector — relay server.
 *
 * What this is: a tiny localhost HTTP+WebSocket server that lets a
 * SignalX app running outside a browser (Lynx native, terminal, a
 * separate process) be inspected from a panel UI rendered in any
 * regular browser tab.
 *
 * Two clients talk through it:
 *   - Page-side: a SignalX app's `@sigx/devtools` plugin configured
 *     with `createWebSocketTransport({ url: 'ws://localhost:8098/page' })`.
 *   - Panel-side: a browser tab pointed at `http://localhost:8098/`
 *     loads a standalone HTML panel that opens
 *     `ws://localhost:8098/panel`.
 *
 * The server relays envelopes between them. v0 supports one page + one
 * panel at a time — multi-app inspection is plumbed for later
 * (`appId` in the protocol) but not exposed here.
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';

const TAG = 'SIGX_DEVTOOLS' as const;

const __dirname = dirname(fileURLToPath(import.meta.url));
// The panel UI is built into `<repo>/dist-panel/` by `pnpm build:panel`.
// dist-server lives at `<repo>/dist-server/`, so up one and over.
const PANEL_DIR = resolve(__dirname, '..', 'dist-panel');

const DEFAULT_PORT = 8098;
const port = Number(process.env.SIGX_DEVTOOLS_PORT ?? DEFAULT_PORT);

// ---- HTTP: serve the panel UI ----
// Tiny static file server. The panel is a few files (HTML + bundled
// JS); we don't need a full static server.
const MIME: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js':   'application/javascript; charset=utf-8',
    '.css':  'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.map':  'application/json; charset=utf-8',
    '.svg':  'image/svg+xml',
};

const httpServer = createServer(async (req, res) => {
    if (!req.url) { res.writeHead(400); res.end(); return; }
    // Default to /panel.html for the root path.
    let pathname = req.url.split('?')[0]!;
    if (pathname === '/' || pathname === '') pathname = '/panel.html';
    // Defend against path traversal — the path must resolve under PANEL_DIR.
    const filePath = resolve(PANEL_DIR, '.' + pathname);
    if (!filePath.startsWith(PANEL_DIR)) {
        res.writeHead(403); res.end('forbidden'); return;
    }
    try {
        const body = await readFile(filePath);
        const ext = filePath.slice(filePath.lastIndexOf('.'));
        res.writeHead(200, { 'content-type': MIME[ext] ?? 'application/octet-stream' });
        res.end(body);
    } catch (err) {
        res.writeHead(404); res.end('not found');
    }
});

// ---- WebSocket: relay ----
const wss = new WebSocketServer({ noServer: true });

let pageSocket: WebSocket | null = null;
let panelSocket: WebSocket | null = null;
/** Events emitted by the page while no panel was attached. */
const pageBacklog: string[] = [];
const MAX_BACKLOG = 1000;

function log(...args: unknown[]) {
    console.log('[sigx-devtools-inspector]', ...args);
}

function deliverToPanel(raw: string) {
    if (panelSocket && panelSocket.readyState === WebSocket.OPEN) {
        panelSocket.send(raw);
    } else {
        if (pageBacklog.length >= MAX_BACKLOG) pageBacklog.shift();
        pageBacklog.push(raw);
    }
}

function drainBacklogTo(target: WebSocket) {
    while (pageBacklog.length > 0) {
        const raw = pageBacklog.shift()!;
        target.send(raw);
    }
}

httpServer.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    const route = url.pathname;
    if (route !== '/page' && route !== '/panel') {
        socket.destroy();
        return;
    }
    wss.handleUpgrade(req, socket, head, ws => {
        if (route === '/page') {
            if (pageSocket) {
                log('page already connected — closing previous socket');
                try { pageSocket.close(); } catch {}
            }
            pageSocket = ws;
            log('page connected');
            ws.on('message', data => {
                const raw = data.toString();
                // Lightweight validation — drop anything that isn't
                // our tagged envelope so we don't blindly forward
                // anything else that opened the socket.
                try {
                    const parsed = JSON.parse(raw);
                    if (parsed?.__sigx !== TAG) return;
                } catch { return; }
                deliverToPanel(raw);
            });
            ws.on('close', () => {
                if (pageSocket === ws) pageSocket = null;
                log('page disconnected');
            });
            return;
        }
        // route === '/panel'
        if (panelSocket) {
            log('panel already connected — closing previous socket');
            try { panelSocket.close(); } catch {}
        }
        panelSocket = ws;
        log('panel connected');
        // Drain any backlog the page emitted before the panel attached.
        drainBacklogTo(ws);
        ws.on('message', data => {
            const raw = data.toString();
            try {
                const parsed = JSON.parse(raw);
                if (parsed?.__sigx !== TAG) return;
            } catch { return; }
            if (pageSocket && pageSocket.readyState === WebSocket.OPEN) {
                pageSocket.send(raw);
            }
        });
        ws.on('close', () => {
            if (panelSocket === ws) panelSocket = null;
            log('panel disconnected');
        });
    });
});

httpServer.listen(port, () => {
    log(`listening on http://localhost:${port}`);
    log(`open http://localhost:${port}/ to view the panel`);
    log(`page-side WebSocket: ws://localhost:${port}/page`);
});
