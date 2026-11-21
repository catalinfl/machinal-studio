# Project previews

Mode: Operate. Extend the existing Projects popover and editor; no visual-world change.

## Direction contract

THESIS: Opening an MCP-built project reveals its actual prepared timeline, not an empty workspace. Existing user edits remain authoritative.

OWN-WORLD: Inherit the editor's semantic colors, ruled sections, compact sans typography and native media controls.

STORY: Successful generation and full rendering retain a project-scoped compiled JSON snapshot. Opening restores that snapshot when there is no existing working edit; the project menu separately exposes the actual last rendered file and its exact JSON when available.

FIRST VIEWPORT: Keep the editor canvas and timeline dominant. Add the last-render player and JSON action beneath the current project's status inside the existing scrollable popover. At compact widths the player stays within that popover.

FORM: Precisely scoped extension; no new page or identity exploration. Playback is user-controlled, and no new generation/render is triggered by opening a project. Local wiring uses only the installation's durable queue and volume; it remains keyless, without machinal billing or cloud services.

FINISH: Record the narrow review verdict and verification limits; preserve inherited design-system files and pre-existing user work. No new visual system or shipping raster assets.

## Finish evidence

- **SHIP, narrow scope:** [review verdict](../review/project-previews-verdict.md); no material findings. The reviewer checked all eight hosted/local captures: local `project-previews-local-{1440,390}-{light,dark}.png`, hosted `project-previews-{1440,390}-{light,dark}.png`, in each root's `.impeccable/review/`. This is not whole-editor/full-comp approval.
- **Documented:** [behavior, persistence, recovery limits and reproduction commands](../../docs/PROJECT_PREVIEWS.md). Prepared and exact rendered snapshots remain separate; manual edits, Media Bin changes and intentional clears win. Opening performs no compilation/generation/rendering; filename-only exports explicitly lack a retained editable snapshot. Historical recovery is best-effort from available completed owned project jobs, not replay or guaranteed recovery of expired results/absent originals.
- **Final reported checks, not rerun by documenter:** both roots have Svelte check 0 errors/0 warnings, successful builds with existing PURE-annotation/chunk-size warnings, 33 focused presentation/adapter/TopBar Vitest passes plus 194 editor/composition-file passes, four new Chromium preview passes at 1440/390 in light/dark, Go test/vet projects/compositions/routes passes, Go race projects/compositions passes and UI detector `[]`. Hosted additionally has two existing projects browser passes and clean `git diff --check`; these are not local results. Isolated browser ports: local 5188, hosted 5187.
- **Visual-system boundary:** cross-checked inherited `DESIGN.md` against the token-based components and unchanged editor styles. Its graphite/Roboto description differs from current paper/plum/lilac and IBM Plex Sans tokens; this inherited drift is recorded, not repaired. Existing semantic tokens/native controls are reused; no new visual system, tokens or shipping raster assets. `DESIGN.md`, `PRODUCT.md`, sidecars and unrelated work remain untouched.
- **Verification boundary:** browsers decoded synthetic WebM/PNG and checked downloaded JSON against mocked APIs; screenshots were independently reviewed. No deployment, paid AI, real customer media, production-server or production-video inspection. No claim of full-app, live-provider, accessibility, security or final render/audio-quality certification. Local account/key/billing/cloud exclusions remain governed by `README.md` and `LOCAL_FORK.md`.
