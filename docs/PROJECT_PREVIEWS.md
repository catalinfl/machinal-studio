# Project previews and retained compositions

Opening a prepared project shows its editable timeline instead of an empty workspace. The existing **Projects** popover also exposes the last rendered result and actions to open retained edits directly on the timeline. A recipe/JSON attachment is not a project. Opening a project does not compile, generate media or start a render.

## What is retained

Successful compile-and-generate operations retain their resolved document, bindings and compiled composition, including pinned assets and prepared text. Successful **full-composition** renders retain that same snapshot with the output filename. Plain validation/compilation, preview renders and failed jobs do not publish a new presentation.

The owner/session-scoped record is stored at:

```text
<dataDir>/.project-presentations/<owner>/<session>.json
```

In the standard local installation, `dataDir` is `/data` in the user's volume and the owner is `local`. This JSON lives outside ephemeral job inputs. It holds two independently updated entries:

- `prepared`: the latest retained complete editable composition.
- `lastRender`: the latest retained successful full render, including its filename and its own editable snapshot when available.

A newer preparation can therefore coexist with an older last render. This is not a revision archive or a copy of the original media. Retaining JSON does not guarantee that referenced originals or rendered files remain available; include the volume in backups.

## Opening and protecting working edits

Successful generation and full rendering persist the resolved composition into the actual project's `state.timeline`/`state.media`, without needing a browser autosave. `GET /projects/:projectID` (also exposed under the project-scoped `/v1` API) returns that saved working `state` alongside `presentation` and, on a recovery failure, `presentationWarning`. Loading also repairs older empty/media-only project states from retained snapshots, with the same manual-edit protection. If publication fails after media work succeeds, the operation reports `projectWarning`; keep the successful outputs and retry project recovery, not the paid work.

The client chooses what to restore:

- A never-opened, genuinely empty or media-only saved project hydrates from the prepared snapshot, falling back to a complete last-render snapshot when appropriate. Existing source entries and display names are merged, not discarded merely because the timeline was empty.
- Hydration restores tracks, source geometry, effects/transitions, captions, media entries and output settings through the existing composition adapter. The retained document, bindings, assets and prepared text become a ready document session; resolved generation IDs and caption content/timing are not regenerated.
- An older, untouched hydrated preparation may advance to a different retained composition only when its baseline fingerprint still matches and its ready document session identifies the original preparation.
- Saved manual edits, dirty sessions, Media Bin changes and intentional clears remain authoritative. The fingerprint covers both timeline and media. An existing document session also distinguishes an intentional clear from an uninitialized project. Invalid saved state follows the normal recovery error rather than being silently replaced.

The client retains a compatibility hydration path and normalizes browser-ready state through ordinary versioned autosave. Server publication and HTTP autosaves share a lock across store instances; a stale version receives 409, never silently overwrites a generated edit. Canonical v2 fingerprints ignore JSON key order/escaping and are shared by Go and TypeScript; previous browser fingerprints remain recognized. Session/generation guards prevent stale project loads or queued saves from being applied to another selection. Media Bin additions/removals participate in autosave.

## Last render and editable timeline actions

Inside **Projects**, beneath the current project's status:

- **Last render** shows its filename/date and a user-controlled native video player, or audio controls for MP3 output. There is no autoplay. Playback failure offers a reload message without discarding the timeline.
- **Open rendered timeline** restores that render's retained edit, never an unrelated newer prepared version. It restores source clips, not the MP4 as a flattened single clip.
- **Prepared timeline** and **Open prepared timeline** appear when a complete prepared version differs from the rendered snapshot, including preparation without a render. The section shows duration, frame rate and resolution.
- Filename-only legacy/editor exports can be shown for playback but explicitly say **“No editable snapshot was retained for this export.”** They do not acquire an inferred recipe from a newer preparation.

Both actions ask for explicit confirmation before replacing the current timeline. Existing media is kept, edits save normally, and resolved speech/images/captions are reused without provider or rendering calls. **Keep current timeline** cancels without changing the edit. Download-JSON actions no longer stand in for opening a project. A presentation-loading warning is separate from working-state save errors; a project with no working state cannot silently ignore a failed recovery.

## Historical recovery and limits

When no presentation is retained, the backend makes a best-effort recovery from available completed jobs belonging to the same owner and project session. Supported full-render and compile-and-generate results are considered newest first; previews, failures and other owners/sessions are excluded. Filename-only results remain filename-only unless an exact recorded composition match is available; an unrelated recipe is never substituted.

Expired/unavailable job results, absent original sources and missing output files are not guaranteed recoverable. Recovery does not replay generation or rendering. A presentation read failure returns a warning while preserving the saved working timeline.

## Runtime wiring

`api/internal/routes/local.go` attaches presentation recovery to the durable job repository (`store.Presentations.Jobs = jobs.Store`). Presentation files, source media and exports use volume storage.

Opening/playing a project or downloading its retained JSON does not call an AI provider. Separately requested AI work still requires the installation owner's explicitly configured OpenRouter key and can incur provider charges; this feature neither configures nor tests that key. Preserve loopback-only exposure and Host/Origin checks. [README.md](../README.md) remains authoritative for runtime boundaries.

## Implementation and inherited design

- Backend: `api/internal/core/projects/presentation.go` and `handler.go`; `api/internal/core/editor/compositions/project_presentation.go`, `orchestrate.go` and `queued.go`; `api/internal/routes/project_presentation.go` and local route/job wiring.
- Client: `client/src/lib/project-presentation.ts`, `project-state.ts`, `client/src/composables/useProjects.svelte.ts`, `client/src/components/ProjectsMenu.svelte` and `ProjectRenderPreview.svelte`.

This is an **Operate** extension of the existing editor/popover, not a new visual world. The components reuse semantic surface, ink, border, spacing, radius and focus tokens and native media controls; the player stays inside the scrollable viewport-bounded popover. No new design-system tokens or shipping raster assets were introduced. Synthetic PNG/WebM fixtures and review screenshots are test evidence only.

The documentation cross-check found inherited drift: root `DESIGN.md` describes graphite/Roboto editor values, while the current unchanged `client/src/styles/editor-suite.css` resolves paper/plum/lilac with IBM Plex Sans and Roboto Mono. This extension follows the implemented semantic tokens; it does not refresh `DESIGN.md`, `PRODUCT.md` or sidecars, or authorize a palette/type change.

## Verification evidence

The table below is historical evidence for the original presentation feature, not a fresh test run of this correction.

| Check | Reported result |
| --- | --- |
| Client `pnpm check` | 0 errors, 0 warnings |
| Production client build | Pass; existing PURE-annotation/chunk-size warnings remain |
| Focused presentation/adapter/TopBar Vitest | 33 passed |
| Editor/composition-file Vitest | 194 passed |
| New Chromium project-preview matrix | 4 passed: 1440px/390px, light/dark |
| Go projects/compositions/routes tests and vet | Pass |
| Go race tests, projects/compositions | Pass |
| Changed-UI detector | `[]` |

New tests are `client/e2e/project-previews.spec.ts`, `client/src/tests/lib/project-presentation.test.ts`, `api/internal/core/projects/presentation_test.go` and `api/internal/core/editor/compositions/project_presentation_test.go`.

The Chromium tests use mocked APIs but actual browser-decoded synthetic PNG/WebM, play the fixture through completion and inspect the downloaded JSON. They cover prepared timeline hydration, persistence across reload, manual-edit preservation, no generation/render requests and viewport bounds. The WebM is test data served for a synthetic render filename, not proof of native MP4 encoding.

### Reproduction commands (not executed by the documenter)

From this repository root, with the project's installed toolchain:

```powershell
pnpm --dir client check
pnpm --dir client build
pnpm --dir client exec vitest run src/tests/lib/project-presentation.test.ts src/tests/lib/composition-adapter.test.ts src/tests/components/TopBar.test.ts --maxWorkers=1
pnpm --dir client exec vitest run src/tests/stores/editor.test.ts src/tests/lib/composition-file.test.ts --maxWorkers=1
$env:PLAYWRIGHT_PORT = '5188'
$env:PROJECT_PREVIEW_LOCAL = '1'
pnpm --dir client exec playwright test e2e/project-previews.spec.ts --project=chromium
```

The explicit isolated port prevents reuse of an unrelated dev server. From `api`:

```powershell
go test ./internal/core/projects ./internal/core/editor/compositions ./internal/routes
go vet ./internal/core/projects ./internal/core/editor/compositions ./internal/routes
go test -race ./internal/core/projects ./internal/core/editor/compositions
```

No deployment, paid AI/provider work, real customer media, production-server inspection or production-video inspection was performed for this feature verification. Mocked browser tests, source review and screenshots do not certify the whole editor, a full visual composition, live infrastructure, final render/audio quality, accessibility or security.
