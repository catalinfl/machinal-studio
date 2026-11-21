package toolrouting

type Tool struct {
	Name   string
	Intent string
}

var Catalog = []Tool{
	{"list_projects", "Find the user's existing projects."},
	{"create_project", "Create a new project."},
	{"get_project", "Read an existing project's saved state and version."},
	{"save_project", "Save changes to an existing editor project, not a recipe file."},
	{"get_recipe_schema", "Discover or verify the YAML recipe schema before authoring."},
	{"get_capabilities", "Check supported generation, render settings, effects or provider configuration."},
	{"list_speech_models", "Read supported narration models by language before asking the user to choose; no generation."},
	{"get_speech_model", "Read compatible voices and format for the user's chosen narration model."},
	{"get_editing_reference", "Read targeted editing, YAML, scenes, styles or preset instructions/examples; topic=scenes explains visual coverage and image-versus-SVG/CSS selection before production."},
	{"get_credits", "Check available API credits or report workflow costs."},
	{"request_media_access", "Prepare a consent question before accessing existing media; this never grants consent."},
	{"list_media", "List existing project media after listing approval."},
	{"list_local_media", "List approved local media through owner-scoped read-only configured roots, without uploading. Disabled unless the administrator configures roots/mounts."},
	{"inspect_local_media", "View approved local raster images as bounded MCP thumbnails without importing/uploading originals; free, with separate image-inspection consent."},
	{"import_local_media", "Use approved local files as content-addressed project working copies without network/S3 upload; originals stay read-only. Requires configured local roots, not arbitrary client paths."},
	{"get_asset_metadata", "Inspect approved existing sources for recipe validation or use."},
	{"get_upload_target", "Upload client-local sources to the server's project volume."},
	{"validate_recipe", "Check a YAML composition for errors without generation or rendering."},
	{"compile_recipe", "Compile a YAML composition into a normalized plan without paid execution."},
	{"compile_scene", "Compose and animate approved existing images or simple procedural diagrams using Svelte written by the current client AI; free source compilation, not artwork generation or video rendering. Up to four images per scene, not per video; generate missing complex or overly simplistic SVG/CSS subjects with generate_assets first."},
	{"get_scene_source", "Read an approved live scene's editable source for changes by the current client AI."},
	{"inspect_scene", "Inspect approved live-scene frames as bounded thumbnails and timestamped diagnostics, without encoding a video."},
	{"edit_scene_parameters", "Patch exposed object parameters on an approved versioned scene without rewriting its Svelte or calling a provider."},
	{"handoff_scene", "Transfer declared object pose/appearance between two approved versioned scenes at an exact source frame; no visual inference or timeline replacement."},
	{"generate_assets", "Create approved artwork via image.generate YAML jobs when complex or overly simplistic SVG/CSS would under-represent a subject, including distinct documentary people, places and historical illustrations. Also executes approved speech/caption jobs, without final rendering. For narration finish speech/requested captions in a separate timing-first pass before images; reuse successful assets, respect the approved budget and obtain media/spending consent."},
	{"render_video", "Render an approved YAML composition to a finished video/audio file."},
	{"render_preview", "Render a paid final-composition excerpt with mixed audio; currently bills complete timeline and referenced scene processing, not excerpt duration."},
	{"list_jobs", "Recover recent project jobs or an uncertain submission after reconnecting."},
	{"get_job", "Read one immediate progress snapshot, not wait for a running job."},
	{"wait_for_job", "Wait for a known queued/running generation or render to finish without repeated progress lookups."},
	{"get_job_result", "Retrieve a completed generation's reusable resolved recipe YAML."},
	{"cancel_job", "Explicitly cancel a queued/running job, not merely stop waiting."},
	{"get_video_result", "Receive a completed render as a clickable link or explicitly requested client-local download."},
	{"get_media_download", "Receive a separately approved existing media file by link or requested local download."},
	{"revoke_delivery_link", "Revoke a previously issued file download link."},
	{"get_download_preferences", "Read the client's saved output directory for an explicitly requested local download, not for link delivery."},
	{"set_download_preferences", "Save or clear an approved client-local output directory; never a server/container path."},
	{"get_workflow_preferences", "Read saved style, scene, image and caption defaults before planning."},
	{"set_workflow_preferences", "Save approved editing defaults without changing media permissions, endpoints or credentials."},
}
