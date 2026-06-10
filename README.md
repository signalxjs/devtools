# SignalX DevTools

[![license](https://img.shields.io/npm/l/@sigx/devtools.svg)](./LICENSE)

DevTools for [SignalX](https://sigx.dev/core/). Inspect the component tree, browse signal/computed/effect values, watch store actions and route navigations, all from a familiar devtools panel.

> 🚧 Early development (`0.0.x`). Wire protocol and package APIs may shift.

## 📚 Documentation

Full guides, API reference and live examples → **<https://sigx.dev/devtools/>**

## What's in this repo

This is a pnpm workspace with three packages:

| Package | Purpose |
|---------|---------|
| [`@sigx/devtools`](./packages/devtools) | Page-side plugin you install with `app.use(devtools())`. Bridges the runtime hook to a configurable transport. |
| [`sigx-devtools-extension`](./packages/extension) | Chrome/Edge MV3 DevTools extension. The panel you actually look at when your app runs in a browser. |
| [`sigx-devtools-inspector`](./packages/inspector) | Standalone HTTP+WebSocket inspector for SignalX apps that don't run in a browser (Lynx native, terminal, Node services). |

The page-side plugin (`@sigx/devtools`) is the same whichever way your app runs — only the transport differs. Use the **extension** for apps in Chrome/Edge, and the **inspector** for Lynx, terminal, or Node hosts.

## Taste

```ts
import { defineApp } from '@sigx/runtime-core';
import { devtools } from '@sigx/devtools';

defineApp(<App />)
    .use(devtools())
    .mount('#app');
```

Then — with the SignalX DevTools browser extension installed — open your browser's DevTools on the app's tab and look for the **SignalX** panel. Full setup for the browser extension, Lynx, and Node transports lives at <https://sigx.dev/devtools/>.

## Part of SignalX

- [sigx](https://sigx.dev/core/) — the core framework
- [@sigx/store](https://sigx.dev/store/) — state management
- [@sigx/router](https://sigx.dev/router/) — routing
- [@sigx/terminal](https://sigx.dev/terminal/) — terminal renderer
- [@sigx/lynx](https://sigx.dev/lynx/) — native mobile runtime

## Development

```sh
pnpm install
pnpm build      # builds all three packages
pnpm test       # runs the vitest suite
```

## License

MIT
