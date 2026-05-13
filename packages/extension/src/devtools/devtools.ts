/**
 * Registers the SignalX devtools panel.
 *
 * Runs in the (invisible) devtools page context every time the user
 * opens browser devtools on any tab. Its only job is to register a
 * panel — the host browser then adds a "SignalX" tab next to
 * Elements, Console, etc.
 *
 * The panel itself (panel.html / panel.tsx) handles all UI and talks
 * to the inspected page via a port to the service worker.
 *
 * Edge specifically requires a non-empty `iconPath`; Chrome will
 * accept an empty string but Edge silently skips registration.
 */

try {
    chrome.devtools.panels.create(
        'SignalX',
        'icon.png',
        'panel.html',
        panel => {
            // Hook for future onShown/onHidden behavior. Empty for MVP.
            void panel;
        },
    );
} catch (err) {
    // Anything thrown here means the host browser refused the panel.
    // Surface it loudly so the user can see why the tab is missing.
    console.error('[sigx-devtools-extension] panels.create failed:', err);
}
