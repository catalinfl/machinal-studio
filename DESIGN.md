---
name: machinal
description: A balanced post-production suite for browser-native video editing.
colors:
  command: "#181c23"
  index: "#181c23"
  index-active: "#293955"
  deck: "#202630"
  sheet: "#282f3a"
  rule: "#363f4d"
  ink: "#edf1f7"
  secondary-ink: "#adb8c9"
  datum: "#8ba8ff"
  light-command: "#e9edf4"
  light-deck: "#f6f8fb"
  light-sheet: "#ffffff"
typography:
  interface: '"Roboto Variable", "Segoe UI", system-ui, sans-serif'
  measurement: '"Roboto Mono Variable", Consolas, monospace'
  panel-title: "16px / 1.35, 600"
  control: "12px / 1.35, 500"
  index: "10px / 1.35, 500"
spacing:
  command-height: "58px desktop, 56px compact"
  panel-header-height: "70px"
  tool-index-width: "76px"
  deck-width: "388px initially, resizable from 340px to 600px"
rounded:
  sheet: "8px"
  control: "6px"
  dialog: "14px"
---

# machinal editor — Post-production suite

## Overview

**Creative North Star: "The post-production suite"**

User-approved replacement of the editor's Registration Desk identity, using the balanced composition A. A creator can browse visual sources, work on a generous composition preview and refine time without managing a wall of controls. Graphite work planes recede behind media; labeled tools and progressively disclosed settings make the professional arrangement approachable.

`client/src/styles/editor-suite.css` is the normative editor scope, inherited through `.editor-suite` in `Editor.svelte`, including native dialogs and popovers. The public homepage, API, toolkit and account pages keep their documented surface identities. Earlier editor-specific palette/geometry statements below are historical where superseded by this section.

## Colors

Restrained neutrals plus one blue accent. Default graphite roles are background `#181c23`, surface `#202630`, elevated `#282f3a`, input `#1c222c`, rule `#363f4d`, main ink `#edf1f7` and supporting ink `#adb8c9`. Selection, primary actions and focus use `#8ba8ff` with dark action ink `#14234b`; hover is `#a9bdff`, selected fill `#293955`. Actual errors, success and warnings use semantic rose, teal and amber. Video and audio tracks use blue/teal data colors rather than coloring navigation by tool.

The explicit Light appearance retains the same structure with field `#e9edf4`, surface `#f6f8fb`, elevated/input white, ink `#202b3d`, muted ink `#56657b` and blue `#315bd6`. Account preferences continue persisting the existing theme setting. Playback source colors remain media content.

## Typography

Roboto Variable carries the editor interface; Roboto Mono remains for times, dimensions, numeric values and YAML. Panel titles use 16px/600, dialog headings 22px/600 (20px compact), controls and reading help generally 12–13px, catalog metadata 10–11px. Tool labels use 10px/500 with real outlined SVG icons. Do not number navigation or introduce ornamental display type.

## Layout

A 58px command bar contains brand, timecode, scene generation, Recipe, history, preferences and the primary Render/export action. On desktop a 76px tool rail and resizable visual library start at 388px combined, leaving most width to the preview. The deck resizes from 340px to 600px; preview retains its 1000×540 maximum. The timeline uses approximately the lower third and remains vertically resizable. Library/catalog grids use two columns initially, one at or below 280px sheet width and three at or above 480px.

At 1024px and below, a horizontal tool bar replaces the rail. Opening a library covers the preview work region and provides an explicit Back to edit action; the timeline remains available. Portrait and short landscape layouts bound timeline height, preserve scrolling and stay within the viewport. Mobile undo/redo is available beside timeline position when command-bar history collapses. Work dialogs become full-viewport workspaces at compact widths with scrollable content and anchored actions; compact confirmations remain viewport-bounded.

## Elevation & Depth

Adjacent work planes use tonal changes and fine rules. The monitor uses subtle offset depth; detached dialogs and preference surfaces use the scoped soft shadows. No neon halos or floating card-dashboard structure. Catalog thumbnails are selectable media/treatment objects, not page-section wrappers.

## Shapes

Controls use 6px corners, catalog objects 8px and desktop dialogs 14px. Fields use dark recessed planes (white in Light), visible themed caret and two-pixel keyboard focus. Shared ordinary controls are 36px and primary work-dialog actions 40px; the Media library's compact controls and coarse-pointer sizes are recorded below. Scrollbars and text selection inherit the editor palette. Reduced-motion rules suppress ornamental transitions without changing user-controlled video playback.

## Components

### machinal brand mark

- **Source and palette:** `client/public/machinal-icon.svg` is the canonical geometric M: filled plum (`#26232f`) on a lilac (`#c6adff`) rounded field. These vector colors stay fixed in both themes; this approved brand component does not replace any surface palette or typography.
- **Sizing and wordmark:** `BrandMark.svelte` defaults to 36px. `ProductNav.svelte` uses 36px, reducing to 32px at 600px and below; `SiteFooter.svelte` uses 28px. `TopBar.svelte` uses 24px, reducing to 20px at 1024px and below. Retain the lowercase machinal wordmark alongside the mark, including the editor at 360px.
- **Browser fallbacks:** `client/index.html` declares the SVG plus `client/public/machinal-favicon-32.png` (32px), `machinal-favicon.ico` (16/32/48px) and `machinal-apple-touch-icon.png` (180px). They derive from the canonical SVG through `pnpm icons:generate` in `client`, implemented by `client/scripts/generate-brand-icons.mjs`. PNG payloads carry `tEXt` provenance under `impeccable:prompt`, including the authored origin and source SVG SHA-256; no AI image provider or paid service is involved.
- **Accessible identity:** The mark is decorative (`alt=""`, `aria-hidden="true"`) inside the labeled `machinal home` link to `/`; the visible name remains. Vite and the former direction.al arrow are not brand marks. Ordinary navigation and external-link arrows retain their functional roles.

**Narrow finish:** `.impeccable/review/machinal-brand-verdict.md` is **ship at the single compact-editor wordmark finding scope**, not a fresh whole-surface audit. The initial narrow logo review found no other material logo findings. Source and the four captures named in `.impeccable/surfaces/machinal-brand.md` were inspected for this documentation merge; implementation checks are reported evidence, not rerun here. Browser-tab cache behavior and Apple installation are not visually certified. Existing tokens, credits work and unrelated Impeccable drift remain untouched.

### Video framing control

The preview transport includes a native **Fit / Fill (crop)** selector beside Frame. Fit retains whole-source framing; Fill preserves proportions and center-crops excess content to fill the project frame. Its accessible name is **Video framing**, and its tooltip explains cropping versus bars and preview/export scope. The compact control inherits the editor's theme/focus tokens, remains keyboard-operable and retains a 44px coarse-pointer target. This is a project setting, not a preview-only switch; undo/redo, autosave, YAML and local/server export retain it. Existing projects default to Fit. Narrow evidence and verification: `.impeccable/review/video-framing-verdict.md`.

The same control, field, selection, header and dialog grammar applies across Media, Text, Effects, Styles, Transitions, Speech, Image, AI Edit, Recipe, export and inspectors. Catalog actions preserve click/drag alternatives, search, counts and the actual catalog data.

### Tool sheets

- **Media:** Import header, full-width Local/Server source control, persistent search, quiet filters and count/Select/reload above an unboxed thumbnail grid. The local full layout rewrite and its verified behavior are recorded below.
- **Text:** Voice to text captions leads immediately below the sheet header; typesetting samples follow, grouped by use. The sample is the focal point, not an interchangeable icon card.
- **Effects:** Search and category groups lead a visual grid; samples, treatment names, descriptions and control/duration metadata stay attached to each selectable object.
- **Styles:** Two-column look previews carry names and categories, reflowing with deck width.
- **Transitions:** Paired-frame demonstrations use the same visual grid and preserve selection/junction constraints.
- **Speech, Image, AI:** Share the same sheet geometry and header grammar while preserving their purpose-specific controls and existing access gates.

### Media library rewrite

User choice: “Deliver verified editor, but media bin i Need a new rewrite o f it, it looks really ugly”. The library inherits the approved graphite Post-production suite with a local full layout rewrite. Strict measured editor certification is deferred at the user's election; the original full comp workflow remains incomplete.

- **Source and ownership:** `client/src/styles/media-library.css` defines the library, inheriting `editor-suite.css`. The roughly 100-line `MediaBin.svelte` orchestrates focused `MediaBinToolbar`, `MediaBinEmpty`, `MediaBinItem`, `MediaBinDeleteDialog` and existing `MediaPreviewDialog` views. Unchanged `useMediaBin.svelte.ts` owns import, metadata/deferred loading, filtering, deletion and timeline insertion; no backend change is implied.
- **Browse hierarchy:** Import leads the header. The full-width Local/Server segmented control orders Server first for signed-in accounts (including the reviewed paid fixture), Local first otherwise. Search stays visible; Escape and clear restore the field. All/Video/Audio lead, with Images/AI/Renders under More; an active additional filter names that trigger. Count, Select/Done and reload follow. Renders remain separate from all source filters.
- **Media objects:** Flat, unboxed 16:10 thumbnails use two columns, one at sheet widths ≤280px and three at ≥480px. Filenames use 12px/500, kind/origin 10px, duration mono and a labeled SVG plus action 28px square (36×40px for coarse pointers). Selection adds checks and contextual Select all/Clear, Delete and Cancel, replacing insertion actions. Actual media supplies imagery; synthetic names/accounts are test fixtures only, with no new shipping raster.
- **Feedback and bounds:** Keep visible import progress, loading skeletons, errors, account/local fallback, first-import and filtered recovery states. Desktop retains the drag-or-plus footer hint. At ≤1024px, hide that hint and empty-state art so actions fit. Short landscape (≤500px height) scrolls the whole library rather than only its list; this behavior is source-reviewed.
- **Native dialogs:** The compact, viewport-bounded deletion `alertdialog` first focuses Keep files. Preserve permanent server deletion versus local session removal (device originals remain), busy/cancel rules, failure feedback and timeline-use blocking. Existing preview keeps previous/next, keyboard navigation, explicit Close, focus return and Add to timeline, inheriting the suite's blue audio accent. Dialog behavior is tested; deletion/preview appearance is source-reviewed, without added dialog captures or visual certification.

**Narrow finish:** `.impeccable/review/media-library-verdict.md` is **ship**, with no material fixes; the reviewer opened all 16 captures and all six named components, both relevant stylesheets and the unchanged functional owner. Evidence: `.impeccable/review/media-library-{1440,390}-{dark,light}-{empty,populated,filtered,selection}.png` (1440×900 and 390×900). This does not supersede the historical whole-comp **fix** report below.

**Final reported verification, completed after the last source fix:** `pnpm check` has 0 errors/0 warnings; `pnpm build` passes with existing Rollup annotation/chunk-size warnings; detector `[]` over the six Media UI targets; `git diff --check` passes. Serial focused units pass 355/355 (stores/editor, MediaBin 58, TopBar, Timeline, useEditorPage); browser checks pass 16/16 (library 4, AI 5, suite 2, Image 2, responsive 1, deck 2). The 1440/390 dark/light library matrix covers real PNG import, preview previous/focus return, search/Escape/clear filters, source/export filtering, multi-selection/native delete cancellation and initial focus, timeline deletion blocking, append/undo/redo, drag/drop and width/scroll bounds. These are supplied completed checks, not rerun by the documenter; they postdate the review packet's pending build/detector note. `editor.svelte.ts` now uses `$state.raw` for undoStack/redoStack/pendingSnapshot with bounded immutable updates, enabling toolbar history after ordinary asynchronous media insertion: behavior verification, not a visual-system token.

### Media bin — compact controls

The owner's clutter-reduction refinement supersedes the persistent search, split category tabs and always-visible secondary controls described above. It preserves the incumbent paper/plum editor palette, IBM Plex Sans and existing media operations.

- **Browse first:** The header contains Media bin, a search disclosure and Import. The second row contains the current category, file/selection count and an options disclosure. Normal chrome occupies 100px on desktop and 106px with the reviewed compact touch layout.
- **Search on demand:** The magnifier reveals and focuses Search files. An active query remains visible. Escape clears a query; a second Escape collapses the empty field. Close clears and collapses immediately, restoring focus to the magnifier.
- **One category menu:** All files, Video, Audio, Images, AI generated and Renders appear together, with existing category counts. Selecting a category closes the menu, names the trigger and restores its focus. Final exports retain their dedicated Renders filter.
- **Secondary options:** The ellipsis opens Import to (Server/Local), Display (List/Grid), Select files and Refresh library. These retain existing mode ordering, busy/login guards and persisted display preference. Selection reveals one contextual row: Select all/Clear, Delete and Done; duplicate cancellation controls are removed.
- **Disclosure mechanics:** `MediaBinPopover.svelte` shares top-layer placement, viewport bounds, outside-click dismissal, Escape, arrow/Home/End navigation and focus return. Options align to the panel's trailing edge; categories align to the leading edge. Touch targets retain 40px sizing and short landscape menus remain viewport-bounded.

Narrow review: `.impeccable/review/media-bin-compact-verdict.md`. Evidence uses `media-bin-compact-{1440,390}-{dark,light}-*.png` plus compact landscape captures. Verification completed in this refinement: 59 MediaBin unit tests, nine Chromium browser tests, Svelte check with zero errors/warnings and production build. The mechanical detector returned `[]` during the batched review. No new shipping raster assets.

### Editor ribbon — creation actions

- User-approved placement: Scenes and Recipe live at the right end of the lilac tool ribbon, separated from panel navigation by a quiet one-pixel rule. They are plain icon-and-label dialog triggers, not active panel tabs. The command header retains branding, timecode, history, account settings and Render.
- `EditorCreationActions.svelte` owns one persistent Recipe instance. `Editor.svelte` places it beside desktop/mobile navigation in one shared track; compact widths scroll the complete track. Resizing across the breakpoint preserves the open Recipe dialog and its draft. Scenes retains the existing feature-access flow.
- The ribbon uses theme-specific lilac surfaces and plum ink, with shared hover and keyboard focus treatments. Desktop actions match the 34px tool controls; compact actions retain visible labels and 44px targets.
- Narrow verification: Svelte check has no errors/warnings; TopBar unit tests pass 4/4; detector returns `[]`. Browser checks passed at 1440, 1100, 1025 and 390px in both themes, including dialog opening/closing, Recipe focus return, breakpoint preservation, no document overflow and no browser runtime errors.

### AI Edit assistant lifecycle

- **Persistent mount:** `Editor.svelte` supplies one `AIPanel` through ToolDeck's assistant slot, outside the keyed tool sheet. Visibility uses `hidden` rather than unmounting; in-flight edits and result feedback survive tool switches and hide/reopen within the mounted editor.
- **Floating and docking:** Undocking opens Media behind the assistant. The floating assistant stays available alongside other libraries; hiding/reopening retains its floating mode and position. Dock returns to the AI Edit sheet. Pointer dragging and arrow-key movement remain available, and window resize reclamps floating coordinates to viewport bounds.
- **Compact dismissal:** Entering the layout at 1024px and below clears floating mode, closes task sheets and hides the assistant without resetting its retained session. Back to edit dismisses the docked mobile sheet; reopening restores the instruction and results. This is in-memory editor retention, not durable project storage.

### Speech, Image and AI Edit — compact authoring

The owner's clutter-reduction refinement keeps the existing paper/plum identity and functionality while shortening the default authoring forms.

- **Speech:** Script uses a two-row, vertically resizable field. Generation model, Voice and reusable recipe are initially collapsed disclosures; model and voice summaries expose the current choice or missing sample. Voice cloning, sample selection/trimming, upload and permission confirmation remain inside Voice. The optional sample transcript has its own disclosure and a one-row field.
- **Image:** Uses the same medium dialog width as Speech (680px, viewport-bounded). Generate image / Edit image share one labeled mode dropdown; source selection/upload appears in Edit mode. The prompt uses two rows. Image settings, Destination and the applicable reusable recipe are collapsed, with current model/aspect and destination visible in their summaries.
- **Bounds:** Desktop dialogs fit their content within the viewport and scroll when expanded. Compact layouts retain full-height authoring workspaces. Generation actions and their placement context remain visible in the forms.
- **AI Edit:** The instruction uses two rows and Fast edit lives under Edit options, left-aligned. Undocked width is 320px, bounded by the viewport, with a 320px height cap. Existing dragging, docking, visibility and job retention remain. Enabled button hover uses plum `#593495` with white text, including header controls.

Narrow review: `.impeccable/review/compact-tools-verdict.md`. The continuation reviewed all five desktop/mobile `compact-tools-*.png` captures and relevant source, found no material fixes, and ran the mechanical detector (`[]`) and `git diff --check` successfully. The implementation pass reported 11 browser-test passes, a clean Svelte check and a successful build; those checks were not rerun by the continuation. No new shipping raster assets.

### Recipe UI

- **Register and inspector:** Recipe opens in Actions, with a flat left action register and wider, independently scrolling inspector for image, voice, caption, and text forms. Code DSL remains the advanced editor. Roboto carries form section headings and labels; Roboto Mono carries code and measurements.
- **Stage, then apply:** Each image action owns generation and placement. Sticky Add action / Save action and Cancel controls commit or discard form edits; the anchored dialog Apply runs the staged recipe as one undoable edit and stays disabled during form editing. Generation is deferred until Apply; saving pending YAML exports instructions without running AI. Captions run after the edit.
- **Mobile and retention:** At 760px and below, stack the register above the inspector with scrollable content and an anchored dialog footer. Staged recipe source, including saved actions, imports, and direct DSL edits, survives Close/reopen; reopening returns to Actions.

#### Scene actions extension

- **Content and placement:** `RecipeSceneFields.svelte` adds scene generation/editing alongside images in the existing Actions inspector, through `RecipeActionForm.svelte`, `RecipeActions.svelte` and `CompositionMenu.svelte`. Choose Generate a new scene or Edit an existing scene; editing selects an existing live-scene asset. Both use a prompt and 1–60-second duration. Generation defaults to project aspect/frame rate with an optional aspect override; editing retains source format, images and voice and publishes a new immutable asset. Destination is timeline with a start time, or Media Bin only.
- **Stage, then apply:** Save `scene.generate` / `scene.edit` instructions in `before`; generation/editing runs only at Apply. Existing DSL versions 1–3 support staged jobs, and adding an action preserves an explicitly supplied or omitted document version. Code DSL remains available.
- **Inherited form:** Reuse parent form tokens, ruled sections, sans labels, mono measurements, existing responsive scrolling, sticky action controls and anchored dialog footer.
- **Finish:** Reviewer disposition **ship**, no material fixes at the narrow UI scope; reviewed captures are `.impeccable/review/recipe-scene-1440.png` and `recipe-scene-390.png`. No visual-world change or new shipping rasters.

### Progressive settings and dialog behavior

- **Scenes:** Prompt/voice modes and the brief lead; duration remains a basic control, while spoken language/project metadata unfolds under Advanced settings. Attachments stay directly available. Empty results omit the unused scene register; generated results restore selection and live preview. Generation, recovery, insertion, close/reopen retention and undo behavior remain owned by existing composables.
- **Speech:** Script and voice choice lead. Generation model is an explicit labeled disclosure showing the current model; reusable Recipe output is advanced. Clone permission, sample selection/trimming and all model capabilities remain available.
- **Captions:** Presets and typography lead; edge/color/position and reusable recipes unfold separately. Timed cue selection and review stay intact.
- **Transforms:** Zoom/position remain directly editable. Compositing and motion/keyframes use an advanced disclosure, initially open for already animated clips. Inspectors use real SVG Close controls.
- **Empty project:** The preview provides a direct Open media library action and explains where imported sources enter the timeline; no sample project or produced imagery is injected.

Long names retain full titles/accessible labels. Native dialogs retain protected focus, explicit dismissal and existing job state. The editor wrapper does not change authentication, generation/rendering requests, clip operations or original-media ownership.

**The Context Rule:** Show basic controls first and keep advanced capabilities named and accessible in the same task.

**The Media Rule:** The composition is real user media; mockup travel images are development references only, never shipped defaults.

Recorded editor followup evidence: `.impeccable/review/editor-suite-followup-verdict.md` retains disposition **fix**. The prior AI/Image/browser-regression material fix is resolved; formal comp-led workflow evidence remains unresolved, so this is neither full ship approval nor completed comp gates. Reported checks: zero Svelte errors/warnings; build success with existing chunk-size/pure-annotation warnings; detector `[]` over followup changed UI; 201/201 focused editor unit tests run serially; 49/51 editor browser checks passed with two compiler-dependent Recipe skips; separately 10/10 AI-access checks passed. The older full unit run had 986 passes and two unchanged Home failures, not a full-suite pass. These checks were not rerun by the documenter; mocked AI/backend contracts establish no live billed generation or native server-export verification.

Current review captures: `.impeccable/review/editor-suite-{1440,390}-{workspace,media,effects,styles,transitions,text,speech,scenes,export}.png`, plus `editor-suite-1440-ai.png` (docked), `editor-suite-1440-ai-floating.png`, `editor-suite-390-ai.png`, and `editor-suite-{1440,390}-image.png`. These are development evidence; no shipping raster was generated.

## Do's and Don'ts

- Do carry scoped editor tokens through every dialog, popover and tool surface; preserve keyboard and pointer alternatives.
- Do keep source handling, rendering destinations, paid feature access, job recovery and undo behavior explicit.
- Don't reintroduce numbered navigation, paper/plum editor overrides, decorative motion or media-colored tool navigation.
- Caption bounce animations are existing authored video treatments, not interface motion; do not remove their preview behavior to satisfy a UI-motion detector.

The following sections document separate public surfaces and historical feature contracts. Public-page identities remain scoped to their own implementation. Editor visual rules above supersede inherited Registration Desk styling in historical editor extensions.

### Homepage — One composition, two ways

#### Overview

**Creative North Star: "Registration Desk"**

The homepage gives the browser editor and programmable API equal weight through its offer and paired actions. Its approved demonstration is a looping conveyor: video and image inputs travel into a lilac machinal machine, a YAML recipe feeds in from above, and an illustrated MP4 emerges playing the same two landscapes. Four coordinated ChatGPT/Codex-generated PNGs supply vector-like 2.5D material, restrained bevels and matte volume; live SVG carries text, notation, signals and motion. Paper or charcoal/plum public surfaces, lilac accents, brand typography and fine rules define the homepage identity, separate from the editor's scoped graphite system.

These rules are homepage-specific. `client/src/pages/Home.svelte`, `client/src/components/CreativeFeatures.svelte` and `client/src/components/home/*` define the surface; `home.css` defines its scoped tokens, while `VideoConveyor.svelte`, the `Conveyor*` components, `conveyor.css` and `useConveyorMotion.svelte.ts` own the illustration. The matching `.impeccable/design.json` entry is `extensions.homepage`; unrelated global entries do not determine this surface's tokens. The retained `DirectionDemo.svelte` Canvas/Pixi sandbox belongs to `/toolkit`, not the homepage; its unchanged behavior is identified separately below.

#### Colors

| Scoped token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--home-bg` | `#f3f2ee` | `#1d1b24` | Page field |
| `--home-surface` | `#faf9f6` | `#26232f` | Work sheets and fields |
| `--home-ink` | `#262a30` | `#f3f2ee` | Main copy and preview heading |
| `--home-muted` | `#62606d` | `#bdb6cc` | Supporting copy and measurements |
| `--home-rule` | `#ccc8cf` | `#46404f` | Fine separators and outlines |
| `--home-accent` | `#7047c7` | `#c6adff` | machinal wordmark, actions, focus and playhead |
| `--home-lilac` | `#c6adff` | `#c6adff` | Solid actions and selected clips/mobile workflow |
| `--home-tint` | `#eae3f2` | `#352e44` | Selected tools, hover and API field |
| `--home-code` | `#eae6ef` | `#211e29` | YAML ground |
| `--home-code-ink` | `#593495` | `#d7c3ff` | YAML text |

**The Theme Legibility Rule.** Apply the complete theme to copy, rules, controls and code; the preview heading uses main ink, while measurements use muted ink.

Honor system preference until the shared `SessionMenu` sets the persisted `scrub-theme` override. Lilac-filled actions and selected clips/workflow buttons retain dark ink in both themes. The source artwork, caption-emphasis preview and Docker panel retain their intentional art-directed colors; the latter two use charcoal (`#222833`).

#### Typography

- **Display and interface:** IBM Plex Sans Variable with the existing sans fallbacks. Hero type uses `clamp(55px, 6vw, 84px)`, weight 500, line-height 0.98 and tracking -0.04em; at 760px and below it uses `clamp(55px, 10vw, 78px)` (54px at 380px and below).
- **Section headings:** `clamp(34px, 4.5vw, 62px)`, weight 500, line-height 1.06 and tracking -0.04em. Balance heading lines; use accent on the directional phrase. Feature-row headings are 27px (25px on mobile).
- **Reading copy:** Generally 14–16px with 1.65–1.75 line-height and restrained line lengths (section copy up to 58ch). Keep operational controls quieter than the offer.
- **Code and time:** Roboto Mono Variable with the existing mono fallbacks for YAML, commands, routes and measurements; use tabular numerals for time. Interface and brand copy remain sans.

#### Layout

- Navigation and hero use 5% outer gutters; main explanatory sections use 8%, reducing to 5% at their compact breakpoints. Paired explanatory columns and ruled feature rows preserve a clear reading rhythm; most section padding reduces to 65px vertically on mobile.
- Desktop conveyor: a full-width `1200×390` SVG scene places two source media objects left, the recipe above the central machine and one finished-film object right, on one continuous belt. The finished film shares the source objects' size and proportions (166px desktop, 140px compact), with its bottom aligned to the belt. The surrounding offer, paired editor/API actions and subscription row remain above it; the illustration does not introduce editor panes or a timeline.
- At 640px and below, the scene changes to a `620×620` return-lane composition: inputs and machine occupy the upper lane and output returns below. Preserve source/output hierarchy and image aspect ratios instead of shrinking the desktop diagram wholesale. The heading/control and caption/disclaimer reflow with the scene; the full mobile story may continue below the first viewport. Workflow, feature, API, recipe and Docker columns retain their stacked reading flow, and code wraps within its pane.
- At 760px and below, the hero columns stack and the header retains the wordmark, theme toggle and editor action while the link navigation is hidden. Explanatory gutters tighten at 900px; the workflow overview uses 5% gutters and stacks each row's heading above its detail at 1100px.

**The Preview Registration Rule — retained `/toolkit` sandbox only.** `DirectionDemo` centers its live stage within its column (`margin-inline: auto`), preserves 16:9 and caps its height at 260px; transport and timeline stay registered below it. At 1000px and below, preview/timeline move above controls. These are not homepage conveyor dimensions or layout requirements.

#### Elevation & Depth

Adjacent surfaces are flat and separated by fine 1px rules and tonal changes. YAML and the tinted API section establish their own reading planes; the charcoal Docker section anchors the self-hosting path. Routine homepage workspaces and feature rows do not use elevated card wrappers.

The conveyor's generated machine, folded paper and landscape terrain deliberately carry restrained dimensional shading and soft bevels. This approved illustration material is not a new elevation grammar for public controls or page-section wrappers.

#### Shapes

Square-edged sheets, outlined actions and contiguous registers carry the form language. machinal marks and functional icons are inline SVG with a consistent 1.6 stroke. Keyboard focus uses the themed accent (2px outline, 4px offset); selection also has `aria-pressed`, and drag operations have click or keyboard-button equivalents.

#### Components

- **Actions and fields:** The hero's editor/API actions have equal sizing and lead to `/editor` and `/api`. Homepage navigation and API workflow/closing links lead to protected `/api`; toolkit navigation and “Explore the full toolkit” lead to protected `/toolkit`. Both protected destinations resume after login. Solid actions use lilac with dark ink and a lighter lilac hover (`#d5c2ff`); outlined actions use themed accent and tint hover. Main actions have a 45px minimum height, 12px × 17px padding and 1px borders. Inputs use themed surfaces, ink and fine rules.
- **Homepage conveyor:** `VideoConveyor.svelte` mounts the scene, heading, native Play/Pause button and visible “Illustrative workflow · no files are uploaded” disclaimer. `ConveyorScene.svelte` supplies the belt/topology and a descriptive SVG image alternative. `ConveyorMachine.svelte` combines the retained generated top/feed opening with an authored SVG industrial casing, two centered rotating gears, lights and bounded progress. This is an illustrative workflow, not an upload, generation request, encoded MP4, download or actual rendering job.
- **Generated illustration family:** Shipping assets are `client/public/images/home/direction-machine-ai.png` (768×538), `client/public/images/home/direction-recipe-ai.png` (640×408), `client/public/images/home/direction-mountains-ai.png` and `client/public/images/home/direction-coast-ai.png` (both 768×512). Machine/document retain native alpha; all image placement preserves aspect ratio. Palette/material references coordinate lilac/plum objects and lavender/sage/apricot landscapes. Full-resolution originals live in `.impeccable/assets/home-ai/originals/`; exact prompts/reference chains, crop/output measurements and proportional preparation live in `.impeccable/assets/home-ai/{provenance.json,measurements.json,prepare.mjs}`. Shipping rasters carry their exact generation prompts; preserve that metadata when preparing derivatives. This is AI-generated vector-like raster art within live SVG, not SVG-only artwork or public product proof.
- **Recipe and playing result:** `ConveyorRecipe.svelte` overlays live `story.edit.yaml`, outlined SVG notation and the visual excerpt `look: warm-memory`, `transition: cross-dissolve`, `text: "Scenic route"`, `format: mp4`. It is not a runnable full document or the former version-2 modify-mode sandbox preview. The intentionally light illustrated paper keeps dark recipe ink in both themes. `ConveyorMedia.svelte` reuses the exact two landscape image URLs before and after processing; the result retains the illustrative warm grade, CSS opacity dissolve, live Scenic route title, MP4 label and playhead. No Pixi preset or real media playback is invoked by this result.
- **Conveyor motion and access:** `conveyor.css` authors a 10-second feed/process/output loop, moving belt and process signals. `useConveyorMotion.svelte.ts` permits animation only while unpaused, intersecting the viewport, the document is visible and reduced motion is not requested; it cleans up observers/listeners on teardown. Native Play/Pause has an accessible name and themed keyboard focus. Reduced motion removes the animations and shows the complete static input/recipe/machine/output story with a Reduced motion note. Internal decoration is hidden behind the scene's descriptive alternative.
- **Phase annotations:** Your media and its arrow appear during intake (3–32%, hidden by 42%); Your recipe / Your rules and their guide appear during recipe feeding (20–46%, hidden by 52%); Your next video, its check and the outlet arrow appear during output (56–84%, hidden by 90%). Short opacity ramps follow the shared 10-second clock, including pause, visibility suspension and loop reset. Output sparks peak at 56–60% and disappear by 67%. Reduced motion shows every annotation in the complete static composition. Verified with 29 conveyor browser tests across desktop/mobile and light/dark, including two-cycle phase checks; Svelte check and the detector are clean. Phase captures: `.impeccable/review/conveyor-phases/`.
- **Input reset continuity:** After entering, each source stays at its consumed position and shrunken scale through the end of the loop. Position and scale reset only at the iteration boundary, with both endpoint positions outside the feed window; never interpolate a rapid return across the visible belt. `.impeccable/review/home-conveyor-flicker-verdict.md` records the reproduced 1 ms return-path defect and its 25-test Chromium verification at 1440/390 in light/dark.
- **Outlet fit:** The side opening's clear height now derives from the source/result frame height multiplied by the `.74` emergence scale (85.99px desktop, 72.52px compact), retaining its perspective angle, dark cavity and a fine illustrated lip. The shell mask and cavity use the same path so the small film fits through the opening before growing beyond the arrow. Five focused browser checks verify exact outlet/frame height agreement, retained motion and reduced motion; Svelte check and the detector are clean. Desktop/mobile emergence captures were inspected under `.impeccable/review/conveyor-reverse-intake/`.
- **Industrial-machine refinement:** Preserve the 254×191 machine registration, original raster top/feed opening, recipe clipping paths, calculated side opening, media baselines and belt route. Replace the microwave-like front with chamfered lilac panels, bolted reinforcing ribs and metal-shaded gears. The user rejected the up/down piston, then the film reel and the two rails behind the gears: keep only the two centered rotating gears in the recess, with no carriage, reel, film strip or background rails. `ConveyorBelt.svelte` retains its path and two endpoint hubs while adding a dark segmented tread, layered rails, bearings, fasteners, braced supports and anchored feet. All moving details inherit pause, offscreen suspension and reduced-motion behavior. No new raster assets or public UI tokens; the original PNG and its provenance remain unchanged. Initial verification and captures: `.impeccable/review/conveyor-machinery/`; simplified-gear follow-up: `.impeccable/review/conveyor-machinery-clean/`.
- **Side-slot output:** One MP4 starts behind the machine at 52% of the loop, 1.3 seconds earlier than the previous version, uniformly scaled to `.74`. It stays small for 1.2 seconds, until 64%, when it reaches the desktop arrow. Only then does it reverse the input's shrink effect over 1.4 seconds with `ease-in-out`, reaching full size at 78% without stretching either axis. Translation stays on `.outgoing-film`, scaling on `.film-size`; travel waypoints never restart scaling. At 69% the film passes through its former presentation position without stopping, continuing right until completely outside the scene. Opacity stays at one throughout travel; reset happens only at the loop boundary, never through a fade or visible return. `ConveyorScene.svelte` retains the shell opening, dark cavity and foreground occlusion. Desktop remains grounded on the straight belt; compact motion retains the bend to the return lane before its rightward departure. Reduced motion leaves both groups untransformed at the static presentation position. Roller caps and processing sparks remain unchanged. The prior full conveyor run passed 25 Chromium tests; this delayed-growth refinement passes five focused desktop/mobile light/dark and reduced-motion tests, including the small hold at the arrow, time-reversed scaling, matching source/result dimensions, continuous opaque departure and offscreen reset across two iterations. The mechanical detector is clean. The prior Svelte check and production build passed (existing Rollup build warnings). Phase captures: `.impeccable/review/conveyor-reverse-intake/`. Narrow visual review: inspected desktop small-at-arrow and compact growth captures remain proportionate and consistent with the incumbent composition. No new shipping raster or visual-world change.
- **Retained `/toolkit` interactive sandbox:** `Toolkit.svelte` still mounts `DirectionDemo showApi={false} initialTool="styles"` below its library; it is not mounted on the homepage. `useLandingEditor.svelte.ts` owns state isolated from the real editor store. Add scenes by click or drag; select clips and reorder by drag or earlier/later buttons; apply/remove styles, effects and transitions; add/edit/remove a title; scrub, play/pause and reset. Transitions require two scenes. Clip labels occupy separate spans divided at the overlap midpoint; a dedicated FX lane registers clickable transition markers with each overlap. Selecting a marker plays that cut, and applying a transition plays the cut into the selected scene, then pauses on the clean incoming frame instead of holding two blended headlines at the dissolve midpoint. Show the catalog label and overlap duration below the tracks; truncate long clip labels within their own span. Sandbox playback starts paused; reduced motion disables smooth page scrolling without removing user-driven playback or scrubbing.
- **Retained `/toolkit` preview renderer:** `landing-artwork.ts` draws that sandbox's typographic Canvas source scenes. `useLandingRenderer.svelte.ts` uses the existing catalog through `resolveClipLook`, `planPixiEffectStack`/`createPixiFilters` and `planPixiTransition`/`createPixiTransitionFilter`, including the actual transition shader. Filter bounds cover the complete sprite in its anchor-relative local coordinates, and WebGL's back buffer supplies the outgoing frame for transitions. The typographic fallback is displayed only until the renderer is ready or when WebGL fails, with a status message on failure; sandbox controls remain usable. These renderer requirements do not apply to the homepage illustration.
- **Creation workflows:** `CreationWorkflows.svelte` replaces the former AI studio under the conveyor. “Choose how you create.” introduces four flat, ruled entries: Visual editor (`/editor`), Run locally (`/docs#local-headless`), Use the API (`/api`) and Create through MCP (`/mcp`). Distinguish hands-on timeline editing, local execution, application/script integration and conversational creative direction through a coding agent. Keep browser-local export distinct from Docker/`edit` CLI recipe rendering, and describe the API workspace as a way to try recipes before integration. Desktop uses an editorial heading column beside the four rows; at 640px the introduction, rows and note form one reading column. The secondary `#ai` note preserves subscription-credit information and direct image/caption/text-to-speech editor links without simulated generation controls. No new assets, theme tokens or motion.
- **MCP promotion:** The hero description and `#mcp` link make agent access discoverable without changing the paired editor/API actions. `McpWorkflow.svelte`, between the API and recipe sections, explains Model Context Protocol and names Codex, Claude Code and OpenCode. A flat brief/revision example and ruled capability list focus on intent, conversational refinement and separate media/paid-work approval; prompts are explicitly illustrative and perform no work. Installation stays on `/mcp`, reached through “Connect your coding agent”; do not repeat its installer, API route tutorial or YAML example here. The existing paper/plum tokens, responsive two-column/stacked layout and focus treatment remain. Narrow verification: 9 Home unit tests, 4 Chromium desktop/mobile light/dark tests, Svelte check with zero errors/warnings, successful production build with existing Rollup warnings and detector `[]`. Captures and current-client review: `.impeccable/review/home-mcp/`.
- **Toolkit promotion:** `CreativeFeatures.svelte` makes the real catalog inventory the first visual proof under “The tools are real.” A single tinted, ruled band presents 60 reusable styles, 84 effects and 76 transitions with 72–96px accent numerals, category headings, descriptions and actual preset names. Counts derive from `CATALOG_LOOKS`, `CATALOG_EFFECTS` and `CATALOG_TRANSITIONS`; motion/text totals derive from their respective arrays. Three editorial rows retain timeline, keyframe/text/audio and export capabilities below. At 640px the inventory becomes three contiguous rows, with numerals beside their labels. Keep these full-editor capabilities distinct from the sandbox subset.
- **Svelte scene promotion:** `SceneShowcase.svelte` follows the toolkit with “Create scenes. Built with Svelte.” Explain prompt/narration input, 2D/Three.js design, image/video attachments, full scenes or transparent overlays, revisions and rendering at export. The hosted-generation CTA uses `/editor?ai=scenes`, retaining existing authentication and paid access; `/docs#ai-guide` explains details. The hero includes an in-page Svelte scenes link. Both hero fragment links scroll locally and replace history without dispatching a same-path router navigation.
- **Local Svelte example:** `SvelteSceneExample.svelte` is a client-side typographic SVG scene, not a generated result or a scene-engine render. A labeled native time slider drives reveal/position/rotation and supports keyboard seeking without autoplay. Full scene/Transparent overlay buttons use `aria-pressed`; the overlay shows a functional transparency checkerboard. A native source disclosure identifies its excerpt as simplified, and the caption explicitly rules out AI requests, uploads and rendering. Scoped state never touches the editor project. Existing paper/plum tokens and lilac media plane are reused; no new raster or system token. The showcase stacks below 800px.
- **API and recipes:** Show media + Bearer credentials + YAML → session/upload → compile/render → status polling/download. Displayed routes and recipe behavior follow `api/editengine/README.md` and `api/internal/routes/routes.go`. Recipe forms stage generation; Apply runs it as one undoable edit, while Save YAML can retain pending instructions. Prepared text overlays can be saved in YAML; original media files remain separate.
- **Self-hosting:** Link `https://github.com/catalinfl/viral-server`. After obtaining the repository and configuring `api/.env`, show the one repository-root command `docker compose -f compose.editengine.yaml up --build`, with copy success/fallback feedback and the source-media caveat. Browser-local export remains an editor capability.

**The Shared Proof Rule.** Keep the homepage conveyor, its recipe excerpt and illustrated MP4 explicitly distinguishable from real editor/API processing. The isolated editable composition demonstrating actual presets and the shared renderer remains on `/toolkit`; generated illustration assets are not evidence of a completed product generation or render.

#### Do's and Don'ts

- **Do** keep editor/API actions equally legible and the conveyor's input/recipe/machine/output story coherent across themes and widths.
- **Do** preserve native pause/play, visible keyboard focus, the descriptive scene alternative, the no-upload disclosure and the static reduced-motion story; keep dark recipe ink on its intentionally light paper.
- **Don't** substitute unrelated source/output imagery, stretch the coordinated assets or bake live recipe/branding/processing text into the PNGs.
- **Don't** present the visual recipe excerpt as a saved/runnable project, the illustrated MP4 or progress as a real upload/render, or local AI forms as completed generation.

### Authenticated pages — API and toolkit

#### Overview

`/api` and `/toolkit` extend the accepted homepage Registration Desk into signed-in task surfaces, as requested “la fel.” Reuse the existing workbench and register/inspector grammar. `Api.svelte`, `Toolkit.svelte` and `client/src/components/product/*` are implementation authority; the scoped sidecar entry is `extensions.authenticatedPages`.

Direction and surface purpose remain in `.impeccable/api-direction.md`, `.impeccable/toolkit-direction.md` and their registered briefs at `client/.impeccable/surfaces/client-src-pages-api-svelte.md` and `client/.impeccable/surfaces/client-src-pages-toolkit-svelte.md`. API contracts follow `api/editengine/README.md`, `api/internal/routes/routes.go` and the composition handlers in `api/internal/core/editor/compositions/`.

#### Colors

`ProductShell.svelte` imports `home.css` and `product.css` and applies the existing homepage scope. Use the homepage palette above and `extensions.homepage.colorMeta`, including its system/persisted theme behavior. Paper/plum fields and sheets, lilac actions, tint selection and themed YAML/cURL planes retain their existing roles; unrelated global sidecar colors do not supply these pages. The Theme Legibility Rule also covers fields, native controls, caret, progress, selection and scrollbars here.

#### Typography

IBM Plex Sans carries headings, navigation and controls; Roboto Mono carries YAML, cURL, IDs, routes and measurements. Task headings use a fixed size (3rem), reducing to 2.4rem at 680px and below, with weight 500, line-height 1.05 and tracking -0.04em. Secondary section headings use 1.75rem; sheet headings use 14px. Responsive adaptation changes pane structure rather than scaling the whole workspace.

#### Layout

- **Shared shell:** Center content within 1600px with 5% gutters and 38px top / 70px bottom padding; top padding becomes 28px at 680px. The two-column introduction stacks at that breakpoint. `App.svelte` suppresses its general navigation on these routes so the shared product header owns navigation.
- **API:** Credentials precede adjacent media / YAML / result panes (`minmax(210px, .8fr) minmax(0, 1.8fr) minmax(240px, 1fr)`). Pane proportions tighten at 1100px; workbench and request-guide columns stack at 900px. Credentials become two columns at 1000px and one at 640px; media internals become one column at 640px. Preserve task order and readable code, even when later panes fall below the first viewport.
- **Toolkit:** Category controls and filters precede the register/inspector (`.85fr 1.15fr`). Filters tighten at 850px. At 640px, categories wrap, filters stack, and a bounded register (265px maximum height, versus 620px on desktop) precedes details. The curated playground follows the full library; its reused sandbox puts preview/timeline above controls at 1000px and below.

#### Elevation & Depth

Flat sheets, fine 1px rules and tonal changes separate credentials, workbench panes, library rows and code planes. Selected presets and request/category controls use homepage tint and accent. The existing interactive preview supplies depth through the composition itself.

#### Shapes

Keep square-edged sheets, contiguous ruled registers, outlined secondary actions and the shared inline SVG marks. Fields use native input/select/textarea behavior. Placeholder pseudo-elements use `var(--home-muted)` at opacity 1; caret and keyboard focus use the themed accent. Inherited focus is a 2px outline with 4px offset; native selects use 3px offset.

#### Components

- **Product navigation:** `ProductNav.svelte` provides toolkit/API/docs links, `aria-current="page"`, a shared account/preferences disclosure and a lilac editor action. Trigger labels hide at 900px; at 780px product links move to a ruled second row, and at 680px the header editor action hides while footer/editor links remain available.
- **Authentication:** `RequireAuth.svelte` renders page children only when `auth.isLogged`. Anonymous entry replaces the location with `/login?next=<encoded internal destination>`; `lib/auth-navigation.ts` allowlists `/api`, `/toolkit` and `/editor`, retaining query/hash. `useLoginPage.svelte.ts` returns after password, signup or OAuth through the same helper; the editor AI-deeplink fallback remains. `/editor` stays publicly accessible, while backend routes own HTTP authorization, session ownership and paid render/generation rules.
- **Application keys and copying:** `ApiCredentials.svelte` shows the configured API origin, a named Premium key form and prefix-only active-key register. A newly issued machinal application key is disclosed once with Copy key / I saved this key; revocation uses an inline Confirm revoke / Keep key choice. Login tokens are never displayed or copied. `useAPIKeys.svelte.ts` owns loading/creation/disclosure/confirmation/revocation/error states without browser persistence of secrets. The signed-in account and legacy browser media session remain distinct; session details are secondary disclosure. Shared clipboard feedback retains timed success and manual-copy recovery.
- **API media and source:** `ApiMedia.svelte` offers click/drop upload through `/upload`, then `/compositions/assets` for server metadata and SHA-256 fingerprints, with kind-matched input binding. Its list contains new uploads only; imported saved projects may reference existing session media. `ApiRecipe.svelte` provides video/image starters, import, editable YAML and Save request YAML. `lib/api-explorer.ts` merges imported assets/bindings and retains snapshots; `useApiExplorer.svelte.ts` assigns new IDs without colliding with saved IDs.
- **API execution:** Validate and Compile are pure, non-generating requests. Render first compiles; pending jobs change the explicit action to “Generate & render” and use `/compositions/compile-and-generate`. After a successful replayable document with no unmet requirements/errors, the browser prepares text overlays for video, submits `POST /renders`, polls `GET /renders/{id}` and fetches the completed file with account/session headers before offering a blob download. `ApiResult.svelte` exposes ready, checking, diagnostics/requirements, progress, error and completion states. `useApiExplorer.svelte.ts` owns the phase union, busy controls, session heartbeat, abortable client requests/polling and download-URL cleanup.
- **Request portability:** The request register switches Cloud/Docker/CLI prerequisites, commands and feedback together. Cloud uses `MACHINAL_API_KEY` plus an owned `PROJECT_ID` on `/v1/projects/...`; local Docker uses the same routes without an application key; native CLI uses `edit render/compile` and `--root`, with no project ID or asynchronous polling. The versioned render job resolves source metadata, existing generator actions and text preparation; the unchanged browser workbench still prepares its account/session render request. Save request YAML does not embed original media or invoke providers. The Docs copy examples use authenticated, project-scoped hosted routes and explicitly distinguish legacy browser contracts.
- **Toolkit library:** `lib/toolkit.ts` maps the actual `edit-catalog.ts` / `catalog.v1.json` catalog: currently 60 styles, 84 effects, 76 transitions, 17 motions and 35 text presets. Counts derive from the five catalog arrays. `useToolkit.svelte.ts` owns kind/query/category filters and selection; `ToolkitLibrary.svelte` provides search, filtered counts, ruled native-button rows, descriptions, available read-only parameter ranges, copyable YAML and a Clear filters empty state. Modify-mode examples need a captured timeline; parameter tuning belongs in the editor.
- **Toolkit playground:** Below the full catalog, reuse `DirectionDemo` with `showApi={false}` and `initialTool="styles"`. Its curated presets, Canvas scenes, Pixi rendering, keyboard alternatives and fallback behavior follow the homepage sandbox; local state stays isolated from the actual editor project. No new raster artwork, authored video or audio is required.

**The Authenticated Mount Rule.** Mount product workspaces only for a signed-in account and return to the allowlisted destination after login.

**The Request Preparation Rule.** Keep pure validation/compilation, explicit generation/rendering and saved instructions distinguishable. Browser workbench requests prepare text before legacy rendering; versioned YAML jobs perform preparation inside the bounded asynchronous job. Native CLI runs synchronously and exposes only compile/render actions.

Recorded finish evidence: `.impeccable/review/product-pages-verdict.md` has disposition **ship** with no material fixes. It records opening all 16 existing `.impeccable/review/{api,toolkit}-{desktop,mobile}-{light,dark}.png` and corresponding `*-first-view.png` captures (desktop first views 1440×900; mobile 390×844). Captures use a mocked signed-in fixture with synthetic credentials. Reported prior checks are 20 unit-test passes, five Chromium-test passes with mocked backend contracts, check with zero errors/warnings, build success and detector `[]`; these establish no live billed-AI or native-backend-render verification. This section and `extensions.authenticatedPages` complete the documentation handoff noted as pending in that review.

**Application-key extension handoff:** `.impeccable/review/application-api-verdict.md` is **ship at the three-scored-fix scope only**: mode-specific prerequisites, authenticated versioned Docs examples and the durable API paragraphs above. The documenter inspected current source and all eight `.impeccable/review/application-{keys,guide}-{1440,390}-{light,dark}.png` captures; these show one-time key disclosure and the Cloud guide using synthetic fixtures, with mobile guide captures intentionally below the first viewport. Docker/CLI, Docs, errors and revocation remain source-reviewed, not visually certified. The incumbent paper/plum tokens and ruled work surfaces are unchanged; no new shipping raster or system change is established. `.impeccable/review/application-api-documentation.md` records this boundary and untouched documentation drift; `docs/reports/API_AUTOMATION_VERIFICATION.md` records supplied checks, isolated local Docker/native rendering and untested external PocketBase/service-token and production S3 provisioning. Those checks were not rerun by the documenter and do not constitute whole-interface or backend certification.

#### Do's and Don'ts

- **Do** reuse homepage tokens, visible focus/status feedback and structural responsive panes for these authenticated surfaces.
- **Do** source the full toolkit from the actual catalog and keep its curated sandbox isolated from the editor.
- **Don't** describe a copied JWT as a permanent API key, exported request YAML as automatically render-ready, or mocked evidence as live paid processing.

No floating dashboard of rounded cards, extra toolbars, multicolor media navigation, generic gradients, neon chrome, or large ornamental animations. Use borders and tonal changes to separate adjacent work surfaces. Detached dialogs and floating AI may use elevation because they genuinely leave the work surface.

## Shared navigation — Account and preferences

User-approved refinement: collect appearance, account access and logout in one disclosure across public pages (including login/account) and the editor. `SessionMenu.svelte` owns this UI; the authentication store and destinations retain their existing behavior.

Public navigation separates route links from session actions with a fine rule. Guests see Preferences, Log in and Open editor; members see a circular initial avatar with Account and Open editor. The editor uses the same compact trigger against its command-rail tokens, replacing its separate settings implementation. Labels collapse on compact viewports, retaining accessible names and the avatar/preferences icon.

The public navbar stays a single row for signed-in visitors. Membership & billing, Jobs & downloads, API Keys & credits and Manage account live in its Account disclosure, with the current destination marked by `aria-current="page"` and the Account trigger accented on those routes. Do not add a separate workspace sub-navbar or repeat account-page tabs above Membership, Jobs or API Keys. Compact layouts retain these destinations through Account and the main mobile navigation disclosure.

API Keys and Membership & billing place **Buy more credits** in the page header, before the work surface on compact layouts. Do not bury purchase controls below the credit explanations. `CreditPurchaseDialog.svelte` opens the shared `CreditPurchase.svelte` form in a themed native modal, with an anchored title/Close control and a scrollable body at constrained heights. Escape and Close restore focus to the initiating button; reopening preserves the selected pack. Credit-payment return feedback opens the dialog automatically, and pack-loading failures can be retried inside it. The account-owned balance, membership checkout, server-priced packs and explicit PayPal submission retain their existing contracts.

The 288px popover has a 12px corner radius and the existing offset popover shadow: it is a detached preference surface, not a new page-card language. Identity precedes a two-option Light/Dark segmented control; account links and the quieter logout follow. Selected appearance has themed accent ink and a raised sheet. Long identity text truncates with its full value in the title. Native Popover supplies outside-click dismissal, Escape, focus return and top-layer placement. The panel stays within viewport bounds and closes on resize. Motion is limited to hover color and the disclosure chevron and respects reduced motion.

Appearance uses `useTheme.setTheme`, persisting even when the visitor selects the currently effective system theme. Navigation has one shared implementation rather than independent theme/logout buttons.

## Generate scenes — Editor dialog

### Overview

This dialog now inherits the **Post-production suite** editor scope described above: focused authoring, basic duration settings and an advanced disclosure above the scene register/live preview, with generation and insertion in an anchored footer. `SceneGenerationDialog.svelte`, `SceneImageAttachments.svelte`, `SceneGenerationResult.svelte`, `LiveScenePreview.svelte` and `WorkbenchDialog.svelte` retain their behavioral roles. The new editor surface brief and `extensions.editorSuite` supersede the historical scene-specific visual direction; `extensions.sceneGeneration` continues recording its functional contracts.

### Colors

Use the editor's scoped semantic roles from `client/src/styles/editor-suite.css` and the persisted appearance override. The dialog inherits the same graphite/light system as its parent workspace, without separate paper/plum tool overrides or homepage colors. The semantic-role table below records functional uses; the new editor palette takes precedence over historical color descriptions.

| Existing CSS roles | Dialog use |
| --- | --- |
| `--surface`, `--surface-elevated`, `--input`, `--surface-muted` | Work field, header/footer/register, editable fields and hover/code planes; pale neutrals in light mode and layered plum in dark mode |
| `--foreground`, `--muted-foreground` | Main copy and quieter help, metadata and disclosures |
| `--border`, `--border-strong` | Fine internal rules and the stronger shell/footer boundary |
| `--primary`, `--primary-foreground`, `--primary-hover`, `--primary-subtle` | Solid actions, selected mode/scene ink and tint, themed action contrast and hover |
| `--ring`, `--destructive` | Keyboard focus and actual errors; insertion success stays in main ink |

The command-rail entry uses `TopBar.svelte`'s existing command-control, command-ink and command-rule roles. Keep generated video colors inside the preview; they do not define interface tokens.

### Typography

- **Interface:** Inherit `--font-sans` (IBM Plex Sans Variable and existing fallbacks). The shared dialog title uses `--text-xl` (1.25rem), weight 700 and tight line-height (1.15); scene headings use `--text-sm` (0.8125rem), weight 600. Labels, help, scene titles and actions use `--text-xs` (0.75rem); supporting scene metadata uses `--text-2xs` (0.6875rem). Reading help and descriptions use `--leading-copy` (1.65).
- **Measurements and source:** Inherit `--font-mono` (Roboto Mono Variable and existing fallbacks) for duration input, project format/frame rate, scene indices/counts and component source. Use tabular numerals for measurements. Long scene titles and descriptions wrap; the retained filename truncates with its full name in the title attribute.

### Layout

- **Desktop:** The large `WorkbenchDialog` caps width at 780px and height at 820px, each bounded by the viewport minus 48px. Authoring uses a flexible brief beside 200px settings, with `--space-10` (1.25rem) padding/gap. Results use a 180px scene register beside a flexible preview. The workspace content scrolls while the header/footer stay anchored. The live iframe scales to available width while preserving scene aspect; playback and seek controls follow it. Legacy video previews retain their 290px cap.
- **At 760px and below:** The dialog fills `100vw` × `100dvh` and loses its border/radius. Authoring stacks; settings use two columns with help and format spanning both. The register becomes a horizontal scroll strip of 190px buttons above the live preview. Content padding reduces to `--space-6`; playback controls and anchored footer actions wrap. Voice authoring can place the preview below the first viewport; preserve the scroll path. Legacy video previews retain their 240px cap.
- **Entry:** Generate scenes stays in the command rail. At 1100px and below its visible text hides, retaining the inline SVG, accessible name, title and dialog indication.

### Elevation & Depth

Internal authoring, register and preview planes stay flat, separated by 1px rules and tonal changes. Only the detached native dialog uses the existing themed `--shadow-dialog` and `--scrim`. Shared arrival motion is opacity/transform over 180ms; reduced-motion preference removes the dialog entrance, and global reduced-motion rules minimize transitions. Video playback remains user-controlled.

### Shapes

Use the shared dialog corner (`--radius-lg`, 10px) on desktop and existing small control corners (`--radius-sm`, 4px) for fields, recording controls and footer actions. The scene register is contiguous and square-edged. Mode/recording controls have a 36px minimum height; footer actions have a 40px minimum height. Keyboard focus uses the existing themed 2px outline, with an inset outline for scene rows; the shared close button uses `--focus-ring`.

### Components

- **Entry and access:** The top-bar action calls `requestFeatureGrant('scenes')`; the existing `useAIFeatureAccess.svelte.ts` login/paid flow grants the dialog. Preserve this gate and its existing account/session authorization. Native `WorkbenchDialog` supplies modal focus behavior, an accessible title/description and an explicit Close button. Outside clicks do not dismiss dialogs, and `oncancel` prevents Escape dismissal.
- **Authoring:** From a prompt creates one Svelte scene with one AI component request. From a voice offers a retained recording or server audio, optional visual direction and language. Narration splits by coherent ideas with its original audio range linked to each scene; target length yields to spoken boundaries. The duration accepts 1–60 seconds, and recording help states 3 minutes / 25 MB. Recognized narration is a disclosure when available.
- **Image attachments:** `SceneImageAttachments` sits below the prompt in both prompt and voice modes. Accept up to four JPEG, PNG or WebP files (5 MiB each). Retained thumbnails use a checkerboard to show alpha; long filenames truncate with the full name in `title`. Each image has Remove and an optional directions text input (600 characters maximum), with a visible label and filename-linked `aria-describedby`. Ruled rows, fields, actions and focus inherit the root theme/control grammar; this extension establishes no new design identity.
- **Attached-image source:** Upload originals under unique names, embed their unchanged bytes in `source.images`, and supply them through the component's `images` `$props` for sandbox preview and native server/local export. Compilation needs only component source and configuration. AI receives only names, IDs, measured dimensions and usage directions, not pixel vision. The generation prompt prescribes shared coordinate systems, local anchors for reactions and unified scaling.
- **Scene register and preview:** Numbered buttons show title, actual duration and “Voice included”; selection uses `aria-pressed`. Compiled scenes appear as they become ready. `LiveScenePreview` runs the self-contained component in an opaque-origin sandboxed iframe with Play/Pause and a labeled seek slider, without autoplay. Source disclosure remains plain text. The same component is sought to clip-local time and composed through Pixi in the main preview. Legacy MP4 results retain native video controls.
- **Anchored feedback and actions:** Show preparation, meaningful phase messages, recoverable/terminal errors and insertion feedback. AI writing/transcription/planning use indeterminate progress; compilation and completed scenes advance it. Status uses revision-based long polling. Add scene to timeline appends the live source and original narration range as one undoable edit. Ordinary server/local export materializes scene video at render time and combines it with the existing composition.
- **Retention:** Closing unmounts the dialog without resetting the singleton's draft, recording, image attachments/directions/thumbnails, selected scene or job results; an active job continues. Reopen restores these in-memory values. Removing an image revokes its thumbnail object URL; account-owner change/logout clears attachments and revokes their URLs while resetting generation state. This is close/reopen retention, not durable project storage.

#### Selected-scene editing extension

- **Focused controls:** `SceneGenerationResult.svelte` places Edit scene beside the selected live scene's context. `SceneEditForm.svelte` opens an inline change prompt, 1–60-second duration, Cancel edit and Update scene; busy fields/actions are disabled and the update action reports Editing scene….
- **Preview continuity:** Keep the current preview while updating, then publish the edited result in the same selected register position. The original source remains immutable; source format, embedded images and linked voice are retained. Review the new preview before the existing Add scene to timeline action.
- **Inherited styling:** Use the existing semantic tokens, ruled separation, sans copy, mono duration and visible focus; scene-heading and edit controls wrap at constrained widths within the existing scroll/anchored-footer layout.
- **Finish:** Reviewer disposition **ship**, no material fixes at the narrow UI scope; reviewed captures are `.impeccable/review/scene-edit-1440.png` and `scene-edit-390.png`. No visual-world change or new shipping rasters.

**The Original Job Rule.** Retry status resumes the retained job ID without submitting another generation request; terminal failures stay distinct, and Stop generation remains available during recovery.

**The Visible Recording Rule.** A retained recording stays visible by filename after Close/reopen; Replace recording and Clear recording control the retained file, and choosing media-bin audio clears the upload and picker.

Recorded finish evidence: `.impeccable/review/scenes-verdict.md` records **ship at the two-finding scope**, resolving polling recovery and visible retained voice. All eight final `.impeccable/review/scenes-{1440,390}-{light,dark}.png` and matching `-voice.png` captures were inspected for this documentation pass (1440×900 and 390×900). The fixture uses a mocked paid account/AI job API with actual scene-engine-rendered video bytes. The verdict reports check with zero errors/warnings, build success, 5 scene adapter/manifest unit tests, 155 existing timeline/preview/menu tests and 13 focused Chromium tests passing; Go race/build checks, service/native MP4 rendering and native narration mux verification passed, and detector output was `[]`. OpenRouter/STT responses were mocked; no live billed AI/STT request ran. Docker Compose validation passed, but image build/container execution was unverified because the daemon was unavailable. These checks are reported finish evidence, not rerun by the documenter. API/worker setup remains documented in `scene-engine/INTEGRATION.md`. No approved comp or replacement identity was supplied; screenshots/generated fixture media are development evidence, with no shipping raster assets.

### Do's and Don'ts

- **Do** retain the root semantic theme bindings, ruled register/preview structure, visible recording state and anchored recovery/insertion controls.
- **Do** keep each live scene individually selectable and addable, including its narration and undo behavior; render scene video only during ordinary export.
- **Don't** present status recovery as new generation, a fixed phase percentage as AI token progress, or generated code as running in the authenticated application context.

Live-source update evidence: `.impeccable/review/scenes-live-verdict.md` supersedes the upfront-MP4 behavior above. New captures use `scenes-live-*`; the original captures/verdict are retained as prior evidence. See `services/scene-renderer/README.md` for live source persistence, isolated playback and export materialization. The independently versioned scene library is installed from npm, with no library sources embedded in this repository.

Image-attachment finish evidence: the reviewer verdict is **SHIP at the narrow extension scope**. The reviewer opened all four authoring captures at `.impeccable/review/scenes-images-{1440,390}-{light,dark}.png`. Reported completed checks: 21/21 scene browser regressions, including retained upload, image-pixel capture and local FFmpeg-WASM export-pixel validation; 6/6 service tests, including native exported-video alpha-pixel verification and narration mux; Go race checks for scenes/render/sceneasset and full Go build; Svelte check with zero errors/warnings; frontend build; detector `[]`; and 9 focused unit-test passes. No billed AI was used. These are reported review results, not rerun by the documenter. The extension adds no shipping raster asset; its generated two-pixel alpha PNG is a test fixture only.
