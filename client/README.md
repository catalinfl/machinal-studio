# machinal client

The Svelte 5/TypeScript/PixiJS editor for the standalone Docker API. `/` and `/editor` open the editor; `/docs` explains setup; `/toolkit` exposes the preset catalog.

For the full installation, follow the [root README](../README.md) and run Docker Compose from the repository root. Configure **your own OpenRouter key** in the welcome screen or Settings; **Continue without AI** keeps ordinary editing/export available.

## Native frontend development

Use Node 24 and pnpm 11.9.0:

```sh
pnpm install --frozen-lockfile
pnpm dev --host 127.0.0.1
```

The API defaults to `http://127.0.0.1:8080`. `VITE_API_BASE` can point to your explicitly selected API port. Never use `VITE_*` for an OpenRouter key or other secret.

```sh
pnpm check
pnpm exec vitest run --maxWorkers=2
pnpm build
```

Desktop Chrome/Edge remain the primary target; browser tests use Chromium. Fonts, scene runtime and FFmpeg-WASM assets are installed/bundled through the existing dependencies. See [product scope](../PRODUCT.md).
