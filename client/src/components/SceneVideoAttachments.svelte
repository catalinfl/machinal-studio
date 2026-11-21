<script lang="ts">
  import type { SceneGeneration } from '../composables/useSceneGeneration.svelte'
  import { MAX_SCENE_VIDEOS, SCENE_VIDEO_LOOKS } from '../lib/scene-videos'

  let { generation }: { generation: SceneGeneration } = $props()
  let input = $state<HTMLInputElement>()

  function chooseVideos(event: Event): void {
    const picker = event.currentTarget as HTMLInputElement
    generation.attachVideos(Array.from(picker.files ?? []))
    picker.value = ''
  }
</script>

<section aria-labelledby="scene-videos-title" class="attachments">
  <div class="heading">
    <h3 id="scene-videos-title">Videos to include <span>(optional)</span></h3>
    <button type="button" disabled={generation.busy || generation.draft.videos.length >= MAX_SCENE_VIDEOS} onclick={() => input?.click()}>Attach videos</button>
  </div>
  <input bind:this={input} type="file" aria-label="Videos to include" accept="video/mp4,video/webm" multiple hidden disabled={generation.busy} onchange={chooseVideos} />
  <p class="help">Up to 2 videos · 20 MB and 60 seconds each · H.264 MP4 or VP8/VP9 WebM. Videos are silent; use From a voice for narration.</p>
  {#if generation.videoAttachmentError}<p class="error" role="alert">{generation.videoAttachmentError}</p>{/if}
  {#if generation.draft.videos.length}
    <ul>
      {#each generation.draft.videos as video (video.id)}
        <li>
          <div class="thumbnail">
            <!-- Silent attachment thumbnail; the scene supplies its own narration. -->
            <!-- svelte-ignore a11y_media_has_caption -->
            <video src={video.previewUrl} muted playsinline preload="metadata" aria-label={`Thumbnail of ${video.file.name}`}></video>
          </div>
          <div class="video-details">
            <div class="file-row"><span id={`video-name-${video.id}`} title={video.file.name}>{video.file.name}</span><button type="button" aria-label={`Remove ${video.file.name}`} disabled={generation.busy} onclick={() => generation.removeVideo(video.id)}>Remove</button></div>
            <label for={`video-look-${video.id}`}>Video look</label>
            <select id={`video-look-${video.id}`} bind:value={video.look} disabled={generation.busy} aria-describedby={`video-name-${video.id}`}>
              {#each SCENE_VIDEO_LOOKS as [id, name] (id)}<option value={id}>{name}</option>{/each}
            </select>
            <label for={`video-direction-${video.id}`}>How should AI use this video?</label>
            <input id={`video-direction-${video.id}`} aria-describedby={`video-name-${video.id}`} type="text" bind:value={video.description} maxlength="600" disabled={generation.busy} placeholder="Use as the background, slow it down, then reveal the title…" />
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .attachments { margin-top:var(--space-6); padding-top:var(--space-6); border-top:1px solid var(--border); }
  .heading, .file-row { display:flex; align-items:center; justify-content:space-between; gap:var(--space-4); }
  h3 { margin:0; font-size:var(--text-xs); font-weight:var(--weight-semibold); }
  h3 span { color:var(--muted-foreground); font-weight:var(--weight-regular); }
  button { flex:0 0 auto; min-height:36px; padding:var(--space-3) var(--space-4); border:1px solid var(--border); border-radius:var(--radius-sm); background:var(--secondary); color:var(--foreground); font:var(--weight-semibold) var(--text-xs)/1.4 var(--font-sans); cursor:pointer; }
  button:hover:not(:disabled) { background:var(--surface-muted); }
  button:disabled, input:disabled, select:disabled { opacity:.55; cursor:not-allowed; }
  .help, .error { margin:var(--space-3) 0 0; color:var(--muted-foreground); font-size:var(--text-xs); line-height:var(--leading-copy); }
  .error { color:var(--destructive); }
  ul { list-style:none; margin:var(--space-4) 0 0; padding:0; }
  li { display:grid; grid-template-columns:80px minmax(0,1fr); gap:var(--space-4); padding-block:var(--space-4); border-top:1px solid var(--border); }
  .thumbnail { width:80px; height:64px; align-self:start; margin-top:var(--space-3); background:var(--preview-surface); }
  video { display:block; width:100%; height:100%; object-fit:contain; }
  .video-details { min-width:0; }
  .file-row > span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:var(--text-xs); }
  .file-row button { background:transparent; border-color:transparent; }
  label { display:block; margin-block:var(--space-2); font-size:var(--text-2xs); color:var(--muted-foreground); }
  input[type="text"], select { width:100%; min-width:0; padding:var(--space-4); border:1px solid var(--border); border-radius:var(--radius-sm); background:var(--input); color:var(--foreground); font:var(--text-xs)/var(--leading-copy) var(--font-sans); caret-color:var(--primary); }
  input::placeholder { color:var(--muted-foreground); opacity:1; }
  button:focus-visible, input:focus-visible, select:focus-visible { outline:2px solid var(--ring); outline-offset:2px; }
  ::selection { color:var(--primary-foreground); background:var(--primary); }
  @media (max-width:420px) { .heading { flex-wrap:wrap; } li { grid-template-columns:48px minmax(0,1fr); } .thumbnail { width:48px; height:48px; } }
</style>
