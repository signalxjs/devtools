# Contributing

Thanks for thinking about contributing! This repo is small and approachable — the page-side plugin is ~12 kB, the extension is ~70 kB, and the inspector relay is ~3 kB of server code.

## Setup

```sh
pnpm install
pnpm build
pnpm test
```

Requires Node 20.19+ or 22.12+ and pnpm 10+.

## Repo layout

- `packages/devtools` — page-side plugin (`@sigx/devtools`)
- `packages/extension` — Chrome/Edge MV3 DevTools extension
- `packages/inspector` — Node CLI + standalone panel for non-browser hosts

The extension and inspector both import panel UI components from `packages/extension/src/panel/` — only the connection layer differs between them.

## Trying changes against a real app

The fastest dev loop:

```sh
# Terminal 1 — rebuild the page-side plugin on change
pnpm --filter @sigx/devtools run dev

# Terminal 2 — rebuild the extension on change
pnpm --filter sigx-devtools-extension run dev

# In Edge/Chrome: load packages/extension/dist/ as unpacked, then reload after each build
```

## Tests

```sh
pnpm test           # one-shot
pnpm test:watch     # watch mode
pnpm test:coverage  # with v8 coverage
```

Tests live in `packages/devtools/__tests__/`. The other two packages don't have unit tests today — they're tested manually against the SignalX example apps.

## Commits

Plain commit messages. No `Co-Authored-By` trailers.

## Releases

`@sigx/devtools` follows the SignalX release flow: PR → CI → merge → tag → push. The other two packages are private (the extension is distributed via the Chrome Web Store eventually; the inspector via npm bin).

## License

MIT (same as the rest of SignalX). By contributing you agree your changes are licensed under MIT.
