# @sigx/devtools

Runtime plugin that exposes SignalX apps to an inspector (Chrome extension, standalone inspector, in-page overlay). Renderer- and transport-agnostic.

## Install and use

```ts
import { defineApp } from '@sigx/runtime-core';
import { devtools } from '@sigx/devtools';

defineApp(<App />).use(devtools()).mount('#app');
```

By default, the plugin uses `window.postMessage` and is a no-op in non-browser environments (SSR is safe).

## Options

| Option | Type | Default | Notes |
|---|---|---|---|
| `transport` | `Transport` | postMessage in browser; null in Node | Use `createWebSocketTransport()` for Lynx/native runtimes |
| `appName` | `string` | `'sigx-app'` | Display name in the panel |
| `stores` | `Store[]` | `[]` | Each `@sigx/store` instance to observe for actions + mutations |
| `router` | `Router` | undefined | Router instance to observe for navigations |
| `includeReactivity` | `boolean` | `true` | Set `false` to suppress all signal/effect/computed events |
| `throttleMs` | `number` | `16` | Coalesce same-id `reactive:updated` messages within this window. `0` disables |

## Performance and production builds

The runtime cost when **no devtools hook is installed** is a single global property read plus a null check per signal/effect/computed creation and per signal mutation. The framework size impact is ~200 bytes brotlied — see the `pnpm size` budget in `core/`.

For production builds where you want zero overhead and zero bytes of devtools code in your bundle:

### Option 1: don't call `app.use(devtools())` in production

The simplest and recommended approach. Conditionally install based on the bundler's env flag:

```ts
const app = defineApp(<App />);
if (import.meta.env.DEV) {
    const { devtools } = await import('@sigx/devtools');
    app.use(devtools());
}
app.mount('#app');
```

The dynamic `import()` plus the `if (import.meta.env.DEV)` guard lets Vite (and Rollup, esbuild, Webpack) tree-shake `@sigx/devtools` out of production bundles entirely.

### Option 2: keep reactivity instrumentation, throttle hard

If you want devtools available in production (for support tooling, or a "dev mode" toggle users can flip), keep the plugin installed but bump the throttle:

```ts
app.use(devtools({ throttleMs: 100 }));
```

This caps wire traffic at ~10 updates/sec per reactive primitive.

### Option 3: suppress reactivity entirely

```ts
app.use(devtools({ includeReactivity: false }));
```

You still get the component tree, props inspector, store timeline, and router timeline — but reactive primitives don't generate events. Useful if your app has a lot of signals and you mainly want activity-feed inspection.

## Transports

- `createPostMessageTransport()` (default in browser) — used by the Chrome extension.
- `createWebSocketTransport({ url })` — for Lynx, terminal renderers, or any non-browser host. Pair with `sigx-devtools-inspector` (a localhost relay) or a custom WebSocket server.
- Custom transports just implement the `Transport` interface (`send`, `onMessage`, `close`).

## Internals

The page side speaks a small JSON protocol (`PROTOCOL_VERSION = 1`). Events use a discriminated `t` field, requests carry a numeric `id` for correlation, large or reactive values are passed as `ValueRef` indirections that the panel resolves on demand via `get:value`. See `protocol.ts` for the full shape.
