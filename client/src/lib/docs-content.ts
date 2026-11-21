export interface GuideSection {
  id: string
  title: string
  paragraphs: string[]
  facts?: string[]
  examples?: { id: string; title: string; code: string }[]
}

export const PRODUCT_GUIDES: GuideSection[] = [
  {
    id: 'workflows',
    title: 'Choose your workflow',
    paragraphs: ['Use the editor for visual editing, the API workspace to test recipes, the hosted API for integrations, or the local headless installation for automation on your own machine. They share the composition format, but authentication, media storage and billing are different.'],
    facts: [
      'Browser editor: import media, edit a multitrack timeline, preview changes and export. Hosted projects use your signed-in account.',
      'API workspace: upload, bind, validate, compile and render in the browser using your account session. This is not an application-key request.',
      'Hosted API: project-scoped /v1 routes use a machinal application API key and require an active paid/Pro account. Costly operations use API credits.',
      'Local Docker API: the separate machinal-public installation runs on your computer with no machinal account, application key or hosted API credits.',
      'Local edit CLI: compile or render a recipe from a selected media folder without opening the editor. Provider actions still need configured AI services.',
    ],
  },
  {
    id: 'editor-guide',
    title: 'Editor and media',
    paragraphs: ['Import video, audio or images into the Media Bin and place them on video or audio tracks. Select a clip to inspect and adjust it; use the preview and frame stepping to check the result before rendering.'],
    facts: [
      'Move, trim, split, duplicate, copy/paste and delete clips. Multi-select, snapping, linked source audio and undo/redo support timeline editing.',
      'Adjust speed, volume, opacity, fades, position, scale, rotation and transform keyframes. Apply catalog looks, motion presets, effects with ramps and transitions.',
      'Add titles, captions and text templates. Edit their wording, styling, timing and placement instead of baking them into source footage.',
      'Use the Media Bin pencil to rename a ready item. This changes its project display name, not its filename or API/YAML reference.',
      'Browser-local import keeps originals in this browser. Server import uploads originals into the selected project and enables server workflows.',
      'The toolkit lets you search presets, inspect their parameters and try them in its playground. Use catalog IDs, not display labels, in recipes.',
      'Desktop Chrome and Edge are the intended browsers. Large projects depend on available device memory; mobile editing is secondary.',
    ],
  },
  {
    id: 'projects',
    title: 'Projects, saving and portability',
    paragraphs: ['Open Projects in the editor header to create, rename or switch projects. Timeline changes save automatically; check the pending, saving, saved or error state before leaving. Switching saves the current edit before loading the next project.'],
    facts: [
      'Saved state includes tracks, clips, transforms, effects, transitions, text/captions, output settings and composition recipes. Selection, preview state and undo history are not restored.',
      'Each project has its own media space. A file in a different project is not automatically available; select the correct project or import it there.',
      'Browser-local originals are stored in IndexedDB for this account and project. Opening the saved timeline in another browser does not transfer those originals.',
      'If originals are missing, restore the required files before rendering. Do not clear browser site data if it contains your only copies.',
      'Save YAML keeps the resolved composition and editable recipe separately. It references media; it does not package video, audio or image bytes.',
      'If saving reports a version conflict, reload the authoritative project before editing further. Do not assume another tab’s changes have been merged.',
    ],
  },
  {
    id: 'ai-guide',
    title: 'AI tools, scenes and overlays',
    paragraphs: ['AI tools can propose composition edits, generate images and speech, transcribe audio, build captions and create animated scenes. Review generated content before adding it to your edit. Availability depends on your account access and the tools currently offered.'],
    facts: [
      'Recipe → Actions stages image, voice, caption or text instructions without generating immediately. Apply actions runs generation and compilation as one undoable edit.',
      'Generate scenes accepts a prompt or narration. Keep exact on-screen wording in Text to display and describe layout, motion and camera separately in the visual prompt.',
      'Choose automatic, 2D motion graphics or 3D scene design. Attach images or videos as scene media, and select a screen format and scene length.',
      'Narration input accepts a recording up to 3 minutes and 25 MB, or available server audio. Generated ideas can be reviewed and added separately.',
      'A full scene is added at the end of the video. A transparent overlay is added on a separate upper track at the playhead so the footage below remains visible.',
      'Scenes are editable live content, not just finished video files. Preview and revise a result before inserting it; final video rendering happens during export.',
      'You can close the scene dialog while generation continues, return to review progress, retry status after a connection error or stop generation.',
      'Copy YAML in image, speech and caption tools reuses their selected settings in recipes. Already-materialized recipe actions are not generated again on load.',
    ],
  },
]

export const AUTOMATION_GUIDES: GuideSection[] = [
  {
    id: 'api-keys-guide',
    title: 'API keys and authentication',
    paragraphs: ['Create a named application key in API Keys & credits with an active paid/Pro account. Copy the complete mach_… secret when it is issued: it is shown only once. Use this machinal key for hosted integrations, not your account login credential.'],
    facts: [
      'Send Authorization: Bearer <key> on hosted /v1 calls, including job status and downloads. Never put a key in a URL, recipe, public frontend code or source control.',
      'Up to 10 active keys can belong to one account. Revoke a lost or exposed key and issue a replacement; revocation takes effect on the next request.',
      'Paid access is checked when creating keys and on each application-key request. After your plan ends, listing and revoking existing keys remain available through your login.',
      'All keys share the account’s API credit wallet. Creating more keys does not create more credits.',
      'Hosted browser tools use the account login/session contract. Local Docker calls omit the Authorization header; do not send your hosted secret to a local service.',
    ],
  },
  {
    id: 'api-render',
    title: 'Hosted API: upload, render, download',
    paragraphs: ['Set API_ORIGIN to your deployed API origin, MACHINAL_API_KEY to your application key and PROJECT_ID to an owned project ID. List projects or create one, upload each missing original once, then send a recipe referencing filenames in that project.'],
    facts: [
      'POST /v1/projects/<id>/renders accepts a YAML/JSON recipe or saved project and returns HTTP 202 with id, status and progress. Location identifies the status route.',
      'Render resolves source metadata, runs pending image/voice/scene/caption actions, prepares text and produces the output. You do not need to open the editor first for titles or captions.',
      'Poll GET /v1/projects/<id>/renders/<job>. Download only after completed and use the returned filename; do not guess an output name.',
      'Missing sources or generation failures result in a failed job with recovery information. Jobs may wait in a queue, with one running job per account. Queue and request-rate limits can return HTTP 429.',
      'Queued jobs resume after a service restart. Interrupted running jobs are not automatically replayed to avoid duplicate work and credit charges. Check saved assets and pending usage before resubmitting.',
      'GET /media lists project media; POST /compositions/assets obtains metadata. Validate checks syntax; Compile is deterministic; Compile and generate materializes pending actions.',
      'Project routes also expose /ai/compositions, /ai/edit, /ai/images, /ai/speech, /ai/subtitles and /ai/scenes. These operations and compile-and-generate return HTTP 202 too: follow statusUrl and read result, statusCode and contentType after completion.',
      'GET /v1/projects/<id>/jobs lists recent job summaries. GET or DELETE /jobs/<jobID> beneath that project retrieves the result or requests cancellation. Poll every 3–5 seconds; closing a browser does not cancel server work. Use Idempotency-Key when retrying an uncertain submission.',
    ],
    examples: [
      { id: 'api-project', title: 'List or create an owned project', code: `curl "$API_ORIGIN/v1/projects" \\
  -H "Authorization: Bearer $MACHINAL_API_KEY"
curl -X POST "$API_ORIGIN/v1/projects" \\
  -H "Authorization: Bearer $MACHINAL_API_KEY" \\
  -H 'Content-Type: application/json' --data '{"name":"API videos"}'` },
      { id: 'api-upload', title: 'Upload an original once', code: `curl -X POST "$API_ORIGIN/v1/projects/$PROJECT_ID/upload" \\
  -H "Authorization: Bearer $MACHINAL_API_KEY" -F 'file=@clip.mp4'` },
      { id: 'api-recipe', title: 'composition.edit.yaml — source needs at least 4 seconds', code: `document:
  version: 1
  mode: assemble
  inputs:
    shots: {kind: video, multiple: true}
  sequence:
    use: shots
    each:
      take: {from: 0s, duration: 4s}
      source_audio: remove
  output: {aspect: landscape, resolution: 720p, fps: 30, format: mp4}
bindings:
  shots: [clip.mp4]` },
      { id: 'api-submit', title: 'Submit, poll and download (set JOB_ID and FILENAME from responses)', code: `curl -X POST "$API_ORIGIN/v1/projects/$PROJECT_ID/renders" \\
  -H "Authorization: Bearer $MACHINAL_API_KEY" \\
  -H 'Content-Type: application/yaml' --data-binary '@composition.edit.yaml'
curl "$API_ORIGIN/v1/projects/$PROJECT_ID/renders/$JOB_ID" \\
  -H "Authorization: Bearer $MACHINAL_API_KEY"
curl --get "$API_ORIGIN/v1/projects/$PROJECT_ID/download" \\
  --data-urlencode "file=$FILENAME" \\
  -H "Authorization: Bearer $MACHINAL_API_KEY" --output result.mp4` },
    ],
  },
  {
    id: 'local-headless',
    title: 'Local Docker and edit CLI',
    paragraphs: ['Use the separate machinal-public repository for the local installation, not the hosted application’s Compose file. Start its Docker services and use http://127.0.0.1:8080 as API_ORIGIN. The same project-scoped /v1 calls work without an Authorization header.'],
    facts: [
      'Local installation is keyless and single-user, with loopback-only published ports. It needs no machinal account, paid plan, PocketBase or S3.',
      'Uploaded originals, projects and outputs stay in the local persistent Docker volume. Back it up; deleting the volume removes that data.',
      'Ordinary media recipes need no AI provider key. Generation actions need the corresponding provider configured and can incur that provider’s charges.',
      'The edit CLI reads sources only from --root. Filename bindings resolve automatically. --output never overwrites an existing file; without it a generated output name is used under the media directory.',
      'Text and live scenes need the configured scene service unless valid prepared text is already saved. Native commands read environment variables, not .env automatically.',
      'Native builds use Go 1.27.2 or newer: from api, run go build -o edit ./cmd/edit (Windows: -o edit.exe). The API Docker image already includes edit.',
      'CLI execution does not send a project to the hosted app. If the recipe invokes AI, configured external providers still receive the inputs needed for those actions.',
    ],
    examples: [
      { id: 'local-start', title: 'Start from the public repository directory', code: 'docker compose up --build -d' },
      { id: 'edit-cli', title: 'Compile or render from a media folder', code: `edit compile composition.edit.yaml --root /path/to/media
edit render composition.edit.yaml --root /path/to/media --output result.mp4` },
      { id: 'edit-container', title: 'Run edit in the public Docker installation', code: `docker compose run --rm -v /absolute/media:/media api \\
  edit render /media/composition.edit.yaml --root /media --output /media/result.mp4` },
    ],
  },
  {
    id: 'rendering',
    title: 'Rendering and export',
    paragraphs: ['Render turns the resolved timeline into a downloadable file. In the editor, choose the output format, quality and export destination. Resolution, aspect ratio, framing and frame rate follow project settings. Beside the preview Frame control, choose Fit to keep the whole image or Fill (crop) to fill the frame with a centered crop. For a landscape video in 9:16, Fill crops the left and right sides instead of shrinking the whole image into the vertical frame. Recipes use output.fit: contain (default) or cover. Compiling a recipe is not the same as rendering a video.'],
    facts: [
      'Local in the editor means rendering on this browser’s device. It supports browser-local media and available server originals; complex edits can be slower or memory-intensive.',
      'Server in the hosted editor requires paid access and uploaded sources. It is unavailable while the project contains browser-only media.',
      'Local headless means the Docker API or edit CLI on your machine, not the browser’s Local button. These are separate execution paths.',
      'MP4 and AVI are video outputs; MP3 exports active, unmuted audio only. Low, Normal and High control quality. A final video can show transparent overlays over underlying footage; it is not a standalone transparent-overlay export.',
      'Titles and captions are prepared for export. Live scenes and their attached media must remain available to the rendering service.',
      'Watch the reported progress and errors. Download the completed result and review it before publishing; output time depends on duration, resolution and edit complexity.',
      'If export fails, check missing originals, pending generation, project access and service availability. Correct the cause, then retry rather than repeatedly submitting the same broken recipe.',
    ],
  },
  {
    id: 'pricing',
    title: 'Pricing and API credits',
    paragraphs: ['A prepaid Pro pass includes 1,000 API credits per 30-day paid period. Your balance, exact period end, rendering rate and available credit packs are shown in API Keys & credits. Pricing displays the live catalog; review your selected pass or pack and its USD total before checkout.'],
    facts: [
      'Prepaid credit periods start when access begins, not on the first of the calendar month. Renewing early extends access but does not grant the next allocation immediately. Unused included credits expire at the end of the period; top-ups do not expire. Included credits are spent first. Separate external subscriptions retain their displayed calendar-month allocation.',
      'Membership passes and credit packs are separate one-time payments, without automatic renewal or automatic top-ups. A credit pack does not activate or extend membership, and active paid access is required to buy and use top-ups. Sandbox checkout uses test payments only.',
      'Hosted AI in the browser, API and MCP shares one credit wallet. Server rendering also consumes credits. Uploads, validation, ordinary compilation, polling and downloads do not consume credits.',
      'AI tools consume credits according to the tool and work completed. Estimates are approximate; final usage is confirmed after processing. Rendering is charged per output minute, prorated by compiled duration; scene rendering and final encoding are separate charges. Charges are rounded down to whole credits. Billable speech and transcription calls have a minimum charge of one credit.',
      'Credits are charged after processing, not reserved in advance. Usage still being finalized does not lock your balance or prevent unrelated work.',
      'Completed AI work remains charged if a later render fails or is cancelled. Failed final renders release the rendering debit. Some credit charges may still be pending when the output is ready.',
      'Actual credit usage can exceed an estimate or your remaining balance. Any resulting amount owed must be covered before further paid work can begin.',
      'Credit packs use configured USD prices and PayPal checkout. Credits are added only after server verification of completed payment, not merely after returning from PayPal. Refunds or reversals adjust the balance.',
      'If rates are not configured, paid API generation/rendering is unavailable (HTTP 503). If packs or payment configuration are missing, checkout is unavailable; prices are not invented.',
      'Manual browser editing and browser-local export do not consume credits. Local Docker/native CLI does not use hosted credits; your own setup and external services may have separate costs.',
    ],
  },
]

export const DOCS_FAQ = [
  { question: 'Do I need AI to edit or render?', answer: 'No. Manual timeline edits and ordinary media recipes work without AI. Only recipes or tools invoking generation/transcription need a configured provider and appropriate access.' },
  { question: 'Which key do I need for the hosted API?', answer: 'Create a machinal application key in API Keys & credits and use it to authenticate hosted /v1 requests. Do not use your account login credential or put secrets in recipe YAML.' },
  { question: 'Do I need Pro for local headless rendering?', answer: 'No. The separate public Docker installation and native edit CLI do not require a machinal account or hosted credits. Provider actions can still incur external charges.' },
  { question: 'Does saving a project upload browser-local originals?', answer: 'In the hosted app, no: browser-local originals remain in that browser’s IndexedDB. Uploaded sources live in project server storage. The separate public local app copies local originals to its local API storage during saving.' },
  { question: 'Can I move a project to another computer with YAML alone?', answer: 'Not completely. YAML carries composition state and media references, not original bytes. Transfer or upload the referenced files too, and keep scene/text services available where needed.' },
  { question: 'Can I render without opening the editor?', answer: 'Yes. Submit a recipe to the project-scoped render endpoint or run edit render locally. The render pipeline prepares text and executes pending supported actions; an editor session is not required.' },
  { question: 'Why is Server rendering disabled?', answer: 'Browser-only originals cannot be read by the server. Render locally in the browser or use uploaded originals. Hosted server export also requires paid access.' },
  { question: 'What is the difference between Validate, Compile and Render?', answer: 'Validate checks document syntax and constraints. Compile deterministically builds a composition and reports missing requirements. Compile and generate resolves pending actions. Render produces the output file and can resolve metadata and pending actions as part of the job.' },
  { question: 'Will opening saved YAML generate and charge AI again?', answer: 'Already-materialized actions are not regenerated on load. Editing and rerunning a recipe or submitting unresolved actions can trigger new AI work and, for the hosted application-key API, credit charges.' },
  { question: 'Can I add an animated effect without replacing footage?', answer: 'Yes. Generate a Transparent overlay and add it at the playhead on an upper track. A Full scene is added at the end instead. Review the overlay preview before export.' },
  { question: 'Does renaming media break a recipe?', answer: 'Renaming in the Media Bin changes only the saved display name. Bindings still use the original asset ID or filename, not the new label.' },
  { question: 'Why did the API return 429 or 503?', answer: '429 indicates a request-rate or job-queue limit; wait for active work to finish before retrying. 503 means a required service is temporarily unavailable, not that you should keep resubmitting.' },
  { question: 'Do failed or cancelled jobs cost credits?', answer: 'AI work already performed remains charged. Failed final renders release their rendering debit. Some credit charges may still be pending while usage is being finalized.' },
  { question: 'What happens when my plan expires?', answer: 'Hosted application keys stop authenticating even if purchased credits remain. You can still list and revoke keys through your account. Local headless execution is independent of the hosted plan.' },
  { question: 'Are local workflows completely offline?', answer: 'Media-only CLI/Docker rendering does not need the hosted app, but initial setup may download dependencies. AI actions contact their configured provider. Browser editing and local headless are different environments.' },
]
