# Testing and CI

Run each command from the indicated directory. Use Node.js 24, pnpm 11.9.0 and the Go version in `api/go.mod`. The scene library and precompiled native renderer are installed from npm, not built from an embedded checkout. Install from committed lockfiles; do not update dependencies just to run checks.

## Pull-request checks

From the repository root:

```sh
node --test scripts/documentation.test.mjs
node --test scripts/scene-module-boundary.test.mjs
```

From `client/`:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm test --maxWorkers=2
pnpm build
```

For a focused editor regression pass:

```sh
pnpm exec vitest run src/tests/stores/editor.test.ts src/tests/stores/render.test.ts src/tests/components/Preview.test.ts src/tests/composables src/tests/lib/render-segments.test.ts src/tests/lib/preview-playback.test.ts --maxWorkers=1
```

From `api/`:

```sh
go test ./...
go vet ./...
go test -race ./internal/platform/jobqueue ./internal/platform/mcpserver ./internal/api
```

From `packages/mcp-installer/`:

```sh
npm ci --ignore-scripts
npm test
npm run test:package
```

Installer tests invoke Go to verify synchronized source references. Optional native credential-storage tests can skip on unsupported platforms or without explicit opt-in; never use a customer's saved key for verification.

For native OpenCode downloads/tool-discovery regressions, run `node --test test/download.test.mjs test/opencode-media.test.mjs test/opencode-tools.test.mjs test/opencode-auth.test.mjs` from `packages/mcp-installer/`. These use synthetic streams, isolated temporary directories, mock credentials and local HTTP fixtures, never customer media, public downloads or paid operations. They cover cancellation/cleanup, size/completeness/hash, atomic no-overwrite races, path/device-name validation, connection-time DNS/IP and redirect restrictions, private-origin scoping, API-key isolation, host permission rejection and direct-tool transforms replayed after catalog refresh.

From `services/scene-renderer/`:

```sh
npm ci
npx --no-install playwright install --with-deps chromium
npm test
npm run test:evaluation
```

Service preview tests require Chromium even when native export tests are skipped. Native text/layout checks additionally require `SCENE_BROWSER`; the complete native workflow below enables them.

## Browser editor integration

For the account flows, use an explicit isolated port when another project may already own 5173:

```powershell
$env:PLAYWRIGHT_PORT = '5187'
pnpm --dir client exec playwright test e2e/membership-jobs.spec.ts e2e/credit-account.spec.ts
```

An explicit `PLAYWRIGHT_PORT` disables server reuse and uses `--strictPort`, preventing a test run against an unrelated development server. The fixtures intercept account/payment/job requests and do not create real purchases or renders.

Prepare the synthetic scene media (no provider calls) from `services/scene-renderer/`:

```sh
npm ci
npx --no-install playwright install --with-deps chromium
node scripts/prepare-browser-fixtures.mjs
```

Then from `client/`, install Chromium and run:

```sh
pnpm exec playwright install --with-deps chromium
pnpm exec playwright test e2e/projects.spec.ts e2e/media-library.spec.ts
```

These suites use mocked account/API responses and synthetic images while exercising real browser storage and editor interaction. They start Vite automatically, not the hosted API. They do not establish production authentication, paid generation or final native export correctness. Other E2E suites can require native services or separate fixtures; do not assume the entire E2E directory is hermetic.

`pnpm exec playwright test e2e/video-framing.spec.ts` checks Fit/Fill at desktop/mobile sizes in both themes, pixel-level portrait cropping, undo/redo and autosaved framing. It also performs a real, small FFmpeg-WASM export and decodes its pixels. Native `TestVideoFitNativeAlphaComposition` exercises the server's crop and alpha-mask composition with synthetic PNGs when FFmpeg is on PATH; it skips otherwise.

## Complete synthetic native rendering

From `services/scene-renderer/`, after installing dependencies and Chromium, set `SCENE_BROWSER` to the installed executable and run:

```sh
node scripts/verify-render.mjs
```

For example in PowerShell:

```powershell
$env:SCENE_BROWSER = node --input-type=module -e "import { chromium } from '@playwright/test'; console.log(chromium.executablePath())"
node scripts/verify-render.mjs
```

The script uses the npm package's included renderer, then sequentially runs service/native/API media checks using synthetic fixtures, mocked providers and dependency-supplied FFmpeg/ffprobe. Native checks cover deterministic frames, text, transparency, audio and intermediate quality. Library source checks and cross-platform package-release tests belong to the separate library repository. Run sequentially to avoid concurrent Chromium suites exhausting memory. Native output is not pixel-identical across arbitrary OS/browser/GPU combinations.

`SCENE_FFMPEG` and `SCENE_FFPROBE` override the native binaries, including the API
checks' PATH. Use a current ffprobe for the complete API media suite: the Windows
`ffprobe-static` binary is version 4.0.2 and cannot parse the metadata probe's
`stream_side_data` section. The Linux application images include newer system binaries.

## PocketBase integration boundary

Normal API tests skip real-PocketBase integration unless `POCKETBASE_TEST_BINARY` is set. A binary alone is insufficient: the test also reads `pocketbase/pb_migrations` and `pocketbase/pb_hooks` from the repository root, which are **not shipped in this checkout**. Obtain the matching deployment assets before explicitly enabling these tests. They create isolated temporary databases; never point tests at production data.

## Workflows

- `.github/workflows/ci.yml`: every push/PR and manual dispatch; bounded client workers, API checks, scene checks and Linux/Windows installer tests.
- `.github/workflows/media-integration.yml`: weekly/manual editor-browser and sequential native-render jobs. Failure traces/reports are retained for seven days for the editor-browser job.

Neither workflow receives production secrets, calls paid providers, deploys services or certifies external PocketBase/S3/PayPal configuration. Skipped opt-in integration tests must not be represented as completed verification.
