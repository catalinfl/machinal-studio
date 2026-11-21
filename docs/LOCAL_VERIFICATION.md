# Standalone verification

Local verification on Windows, 5 November 2026. No production key, maintainer volume or paid OpenRouter request was used. Nothing was published to GitHub/npm, and no changes were applied to the original repositories.

## Completed checks

| Check | Result |
| --- | --- |
| `go test ./...` from `api` | Passed |
| `go vet ./...` | Passed |
| `go test -race ./internal/platform/jobqueue ./internal/api` | Both packages passed on Windows |
| `pnpm check` from `client` | 0 errors, 0 warnings |
| Frontend Vitest suite | 97 files, 1165 tests passed |
| Installer `npm test` | 302 passed, 8 intentionally skipped, 0 failed |
| Installer `npm run test:package` | Real tarball installed for both Server and keyless Local |
| Installer `npm run check:reference` | 125 shared/hosted reference files and the separate local reference bundle synchronized |
| Documentation links and scene module boundary | 22 checks passed, including this report |

Installer skips cover optional developer-installed skill comparisons, a platform-specific symlink check and an opt-in native credential test; they are not failed local tests. The frontend test runner emits jsdom canvas-stub notices, not test failures. Installer dependency installation reported 24 inherited moderate advisories; no unrelated bulk dependency upgrade was attempted.

## Docker and browser evidence

The isolated Compose project is `machinal-local-verification`, using client port **15173**, API port **18090** and its own named volumes. It does not use the normal installation's 5173/8080 ports or data.

The initial stack passed actual keyless MCP initialization, local project creation, current-client Svelte compilation, Chromium scene rendering, final MP4 encoding and volume-link download. The one-second synthetic output is 8836 bytes, with SHA-256 `69953c9ee4df7216c189b9b56dbf8bf07dc35f08cd07f99b7559e127ad432f1a`. Project/job IDs and the exact recipe are retained under the ignored `.local-verification` directory, not shipped as user media.

Desktop (1440×900) and mobile (390×844) browser checks passed the welcome, Continue without AI, editor and OpenRouter settings flow. Removed account links were absent and `/login` returned the local not-found page. Both sizes made **zero requests outside the isolated installation**. Screenshots were inspected without identified defects; a mechanical UI detector returned no findings. This is bounded evidence, not a guarantee for every browser or workflow.

The final source was rebuilt against the same isolated volumes after the model-default, capability and local-guide updates. All three containers became healthy. The complete synthetic MCP → Svelte → scene frames → MP4 → local download flow passed again, including assertions that scene rendering requires no provider, advertises no machinal billing, and the live brief requires no hosted wallet. The output reproduced the same byte count and SHA-256 above; final recipe/job IDs are in `.local-verification/final-render/checkpoint.json`.

The rebuilt client passed both viewport checks again with zero external requests. Final welcome/editor screenshots under `.local-verification/final-ui` were also inspected without identified defects. This run did not watch or listen to a production film, test paid providers, or repeat the earlier mechanical UI detector.

Verified image digests:

- API: `sha256:693616837b8d6824fa08e6ecc0ec7cc37718b7062f9ecf5497f8537dbd6543cf`
- Client: `sha256:d00029c793766ecbfb909f484f8b29cb8ee510afee9e25bfa25182b42bcf3482`
- Scene renderer: `sha256:e4550259738555d1ef9d6c2c1f33597ff50f88940508f29ffd9349e93e0dc752`

Only this verification project's containers were stopped afterward. Its named volumes and all local evidence were retained. Docker Desktop was started for verification and left running; no engine settings or unrelated containers were deliberately changed.

## Repeat without overwriting evidence

Start an isolated stack with `API_PORT=18090`, `CLIENT_PORT=15173`, an empty `OPENROUTER_API_KEY`, and `docker compose -p machinal-local-verification up --build -d --wait`. Do not reuse a volume containing a real provider key: the synthetic test explicitly rejects configured AI.

From the repository root, select a **new empty directory** through `LOCAL_VERIFY_DIRECTORY`, then run `node scripts/verify-local.mjs`. For browser evidence, run `node scripts/verify-local-ui.mjs` from `client`, using a different new directory. `LOCAL_VERIFY_API` / `LOCAL_VERIFY_CLIENT` select the test endpoints; the browser verifier currently allows only the isolated 18090/15173 ports. Existing evidence is never overwritten. These scripts generate only synthetic local material, not provider media or a cinematic-quality demonstration.

Stop only this test project with `docker compose -p machinal-local-verification stop`. Do not run `down -v`: the retained volume contains recovery/checkpoint evidence.

## Deliberate limits

- No real-key image, speech, transcription or AI-edit request was made; model defaults are configuration choices, not verified provider availability or price/quality guarantees.
- This is a loopback-only single-user runtime, not an authenticated public deployment.
- The independent repository has no commit/publication yet. Original repositories may already contain unrelated user changes; they were not reverted or imported as Git history.
- This verification is not an exhaustive security audit or an assertion that all inherited hosted integration tests apply locally.
