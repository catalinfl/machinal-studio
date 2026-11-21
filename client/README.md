# machinal local client

The current Svelte 5/TypeScript/PixiJS editor adapted for the standalone Docker API. No PocketBase SDK, account, application token or subscription lookup is required. `/` and `/editor` open the editor; `/docs` explains local setup; `/toolkit` exposes the current catalog. Hosted account/marketing/legal pages have been removed.

For the full user installation, follow the [root README](../README.md) and run Docker Compose from the repository root. Configure **your own OpenRouter key** in the welcome or Settings; **Continue without AI** keeps ordinary editing/export available.

## Native frontend development

Use Node 24 and pnpm 11.9.0:

```sh
pnpm install --frozen-lockfile
pnpm dev --host 127.0.0.1
```

The local API defaults to `http://127.0.0.1:8080`. `VITE_API_BASE` can point to your explicitly selected local API port. Never use `VITE_*` for an OpenRouter key or other secret. Local source/session access facades are compatibility helpers, not authentication.

```sh
pnpm check
pnpm exec vitest run --maxWorkers=2
pnpm build
```

Desktop Chrome/Edge remain the primary target; browser tests use Chromium. Current fonts, scene runtime and FFmpeg-WASM assets are installed/bundled through the existing dependencies. The build needs no hosted service configuration. See [product scope](../PRODUCT.md) and [local boundaries](../LOCAL_FORK.md).
