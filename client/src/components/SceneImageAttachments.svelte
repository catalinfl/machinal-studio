<script lang="ts">
  import type { SceneGeneration } from '../composables/useSceneGeneration.svelte'
  import { MAX_SCENE_IMAGES } from '../lib/scene-images'

  let { generation }: { generation: SceneGeneration } = $props()
  let input = $state<HTMLInputElement>()

  function chooseImages(event: Event): void {
    const picker = event.currentTarget as HTMLInputElement
    generation.attachImages(Array.from(picker.files ?? []))
    picker.value = ''
  }
</script>

<section aria-labelledby="scene-images-title" class="attachments">
  <div class="heading">
    <h3 id="scene-images-title">Images to include <span>(optional)</span></h3>
    <button type="button" disabled={generation.busy || generation.draft.images.length >= MAX_SCENE_IMAGES} onclick={() => input?.click()}>Attach images</button>
  </div>
  <input bind:this={input} type="file" aria-label="Images to include" accept="image/jpeg,image/png,image/webp" multiple hidden disabled={generation.busy} onchange={chooseImages} />
  <p class="help">Up to 4 images · 5 MB each · JPEG, PNG, WebP. Transparency is preserved. Describe each image and where it should appear.</p>
  {#if generation.attachmentError}<p class="error" role="alert">{generation.attachmentError}</p>{/if}
  {#if generation.draft.images.length}
    <ul>
      {#each generation.draft.images as image (image.id)}
        <li>
          <div class="thumbnail"><img src={image.previewUrl} alt="" /></div>
          <div class="image-details">
            <div class="file-row"><span id={`image-name-${image.id}`} title={image.file.name}>{image.file.name}</span><button type="button" aria-label={`Remove ${image.file.name}`} disabled={generation.busy} onclick={() => generation.removeImage(image.id)}>Remove</button></div>
            <label for={`image-direction-${image.id}`}>How should AI use this image?</label>
            <input id={`image-direction-${image.id}`} aria-describedby={`image-name-${image.id}`} type="text" bind:value={image.description} maxlength="600" disabled={generation.busy} placeholder="Product cutout: center it, then slowly zoom in…" />
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
  button:disabled, input:disabled { opacity:.55; cursor:not-allowed; }
  .help, .error { margin:var(--space-3) 0 0; color:var(--muted-foreground); font-size:var(--text-xs); line-height:var(--leading-copy); }
  .error { color:var(--destructive); }
  ul { list-style:none; margin:var(--space-4) 0 0; padding:0; }
  li { display:grid; grid-template-columns:64px minmax(0,1fr); gap:var(--space-4); padding-block:var(--space-4); border-top:1px solid var(--border); }
  .thumbnail { width:64px; height:64px; align-self:center; background-color:var(--surface-muted); background-image:conic-gradient(var(--border) 25%, transparent 0 50%, var(--border) 0 75%, transparent 0); background-size:12px 12px; }
  img { display:block; width:100%; height:100%; object-fit:contain; }
  .image-details { min-width:0; }
  .file-row > span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:var(--text-xs); }
  .file-row button { background:transparent; border-color:transparent; }
  label { display:block; margin-block:var(--space-2); font-size:var(--text-2xs); color:var(--muted-foreground); }
  input[type="text"] { width:100%; min-width:0; padding:var(--space-4); border:1px solid var(--border); border-radius:var(--radius-sm); background:var(--input); color:var(--foreground); font:var(--text-xs)/var(--leading-copy) var(--font-sans); caret-color:var(--primary); }
  input::placeholder { color:var(--muted-foreground); opacity:1; }
  button:focus-visible, input:focus-visible { outline:2px solid var(--ring); outline-offset:2px; }
  ::selection { color:var(--primary-foreground); background:var(--primary); }
  @media (max-width:420px) { .heading { flex-wrap:wrap; } li { grid-template-columns:48px minmax(0,1fr); } .thumbnail { width:48px; height:48px; } }
</style>
