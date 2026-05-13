# SignalX DevTools

[![license](https://img.shields.io/npm/l/@sigx/devtools.svg)](./LICENSE)

DevTools for [SignalX](https://github.com/signalxjs/core). Inspect the component tree, browse signal/computed/effect values, watch store actions and route navigations, all from a familiar devtools panel.

> 🚧 Early development (`0.0.x`). Wire protocol and package APIs may shift.

## What's in this repo

This is a pnpm workspace with three packages:

| Package | Purpose |
|---------|---------|
| [`@sigx/devtools`](./packages/devtools) | Page-side plugin you install with `app.use(devtools())`. Bridges the runtime hook to a configurable transport. |
| [`sigx-devtools-extension`](./packages/extension) | Chrome/Edge MV3 DevTools extension. The panel you actually look at when your app runs in a browser. |
| [`sigx-devtools-inspector`](./packages/inspector) | Standalone HTTP+WebSocket inspector for SignalX apps that don't run in a browser (Lynx native, terminal, Node services). |

## When to use which

| Your app runs in… | Use |
|---|---|
| Chrome / Edge (web page) | Extension |
| Lynx on a phone / emulator | Inspector |
| Terminal (`@sigx/terminal`) | Inspector |
| Node service | Inspector |

The page-side plugin (`@sigx/devtools`) is the same in either case — only the transport differs.

## Quick start (browser)

```ts
import { defineApp } from '@sigx/runtime-core';
import { devtools } from '@sigx/devtools';

defineApp(<App />)
    .use(devtools())
    .mount('#app');
```

Then install the [extension](./packages/extension), open DevTools on your app's tab, and look for the **SignalX** panel.

## Quick start (Lynx / Node / non-browser)

```ts
import { defineApp } from '@sigx/runtime-core';
import { devtools, createWebSocketTransport } from '@sigx/devtools';

defineApp(<App />)
    .use(devtools({
        transport: createWebSocketTransport({
            url: 'ws://<dev-machine-ip>:8098/page',
        }),
    }))
    .mount(root);
```

Run the inspector on your dev machine, then open the URL it prints:

```sh
npx sigx-devtools-inspector
# → open http://localhost:8098/
```

## Production builds

For zero-overhead production, gate `app.use(devtools())` behind your bundler's dev flag:

```ts
if (import.meta.env.DEV) {
    const { devtools } = await import('@sigx/devtools');
    app.use(devtools());
}
```

The dynamic import + dev gate lets Vite (and any modern bundler) tree-shake `@sigx/devtools` entirely out of the production bundle. See [`packages/devtools/README.md`](./packages/devtools/README.md) for the full production guidance and tuning options (throttling, reactivity filtering).

## Development

```sh
pnpm install
pnpm build      # builds all three packages
pnpm test       # runs the vitest suite
```

To work on the extension against a local app:

```sh
pnpm --filter sigx-devtools-extension run dev   # rebuilds dist/ on change
# Load /packages/extension/dist/ into chrome://extensions/ → Load unpacked
```

## License

MIT
