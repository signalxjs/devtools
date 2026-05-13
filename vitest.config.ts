import { defineConfig } from 'vitest/config';

export default defineConfig({
    // Vite 8 uses Oxc for JSX transforms — match the runtime that
    // tests build against (sigx ships @sigx/runtime-core's jsx-runtime
    // via the `sigx` package).
    oxc: {
        jsx: {
            runtime: 'automatic',
            importSource: 'sigx',
        },
    },
    test: {
        environment: 'happy-dom',
        include: ['packages/**/__tests__/**/*.test.{ts,tsx}'],
        globals: true,
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'html'],
            include: ['packages/*/src/**/*.ts'],
            exclude: ['**/*.d.ts', '**/index.ts'],
        },
    },
});
