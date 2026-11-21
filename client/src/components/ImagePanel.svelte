<script lang="ts">
  import UiSelect from './UiSelect.svelte'
  import WorkbenchDialog from './WorkbenchDialog.svelte'
  import { useImagePanel } from '../composables/useImagePanel.svelte'
  import { imageJobSnippet } from '../lib/composition-recipes'
  import RecipeSnippet from './RecipeSnippet.svelte'
  import { IMAGE_STYLE_OPTIONS } from '../lib/image-panel'

  interface Props {
    onClose?: () => void
  }

  let { onClose }: Props = $props()
  const imagePanel = useImagePanel()
</script>

<WorkbenchDialog id="image-panel" ariaLabel="AI image workbench dialog" title="Image" subtitle="Generate or transform" metered {onClose}>
  <form class="image-workbench" onsubmit={imagePanel.submitForm}>
    <div class="intent-strip">
      <div class="intent-mark" aria-hidden="true">
        <svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="14" rx="1.5" /><path d="m7 15 3-3 2.5 2.5 2-2L19 17M8 9h.01" /></svg>
      </div>
      <p>Make the frame you need, then send it to the Media Bin or lay it over the edit.</p>
    </div>

    <div class="field-group">
      <label for="image-mode">Mode</label>
      <UiSelect id="image-mode" label="Image mode" value={imagePanel.mode}
        options={[{ value: 'generate', label: 'Generate image' }, { value: 'edit', label: 'Edit image' }]}
        disabled={imagePanel.working}
        onChange={(mode) => mode === 'edit' ? imagePanel.selectEditMode() : imagePanel.selectGenerateMode()} />
    </div>

    {#if imagePanel.mode === 'edit'}
      <section class="field-group source-group">
        <div class="field-head"><label for="image-source">Source image</label><span>Server only</span></div>
        {#if imagePanel.proxyEditingAvailable}
          <div class="source-row">
            <UiSelect
              id="image-source"
              label="Source image"
              value={imagePanel.sourceName}
              options={imagePanel.proxyImages.map((source) => ({ value: source.name, label: source.name }))}
              placeholder={imagePanel.proxyImages.length === 0 ? 'No server images available' : 'Choose an image'}
              disabled={imagePanel.working || imagePanel.proxyImages.length === 0}
              onChange={(name) => { imagePanel.sourceName = name }}
            />
            <button type="button" class="secondary upload" disabled={imagePanel.working || imagePanel.uploading} onclick={imagePanel.openFilePicker}>
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 13V3m0 0L6.5 6.5M10 3l3.5 3.5M4 11.5v3A2.5 2.5 0 0 0 6.5 17h7a2.5 2.5 0 0 0 2.5-2.5v-3" /></svg>
              {imagePanel.uploading ? 'Uploading…' : 'Upload'}
            </button>
            <input bind:this={imagePanel.fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/bmp" onchange={imagePanel.uploadReference} hidden />
          </div>
          {#if imagePanel.selectedSource?.scrubBlobUrl}
            <div class="source-preview">
              <img src={imagePanel.selectedSource.scrubBlobUrl} alt={`Preview of ${imagePanel.selectedSource.name}`} />
            </div>
          {/if}
        {:else}
          <p class="mode-note">Switch the Media Bin to Server mode before sending an uploaded image to AI.</p>
        {/if}
      </section>
    {/if}

    <section class="field-group prompt-group">
      <label for="image-prompt">{imagePanel.mode === 'edit' ? 'Describe the changes' : 'Describe the image'}</label>
      <textarea
        id="image-prompt"
        rows="2"
        bind:value={imagePanel.prompt}
        maxlength="4000"
        disabled={imagePanel.working}
        placeholder={imagePanel.mode === 'edit' ? 'Remove the background and give it a clean editorial cutout style…' : 'A paper calendar and clock arranged as a clean productivity metaphor…'}
      ></textarea>
    </section>

    <details class="advanced-settings">
      <summary>Image settings · {imagePanel.selectedModel.label} · {imagePanel.aspect}</summary>
      <div class="advanced-body">
    <section class="field-group background-group">
      <label class="background-choice">
        <input type="checkbox" checked={imagePanel.transparentBackground} disabled={imagePanel.working} onchange={imagePanel.toggleTransparentBackground} aria-label="Transparent background" aria-describedby="image-background-note" />
        <span><strong>Transparent background</strong><small>Return a PNG with a real alpha channel.</small></span>
      </label>
      <span id="image-background-note" class="field-note">
        {imagePanel.transparentBackground ? `Uses ${imagePanel.selectedModel.label} for a transparent PNG.` : 'The prompt will require a complete, fully opaque background.'}
      </span>
    </section>

      <section class="generation-grid" aria-label="Generation settings">
        <div class="generation-field">
          <label for="image-model">Model</label>
          <UiSelect
            id="image-model"
            label="Model"
            value={imagePanel.model}
            options={imagePanel.availableModels.map((option) => ({ value: option.id, label: option.label }))}
            disabled={imagePanel.working}
            onChange={imagePanel.selectModel}
          />
          <span class="field-note">{imagePanel.selectedModel.price} · {imagePanel.selectedModel.output}</span>
        </div>
        <div class="generation-field">
          <label for="image-aspect">Aspect ratio</label>
          <UiSelect
            id="image-aspect"
            label="Aspect ratio"
            value={imagePanel.aspect}
            options={imagePanel.selectedModel.aspects.map((option) => ({ value: option, label: option === 'auto' ? 'Auto' : option }))}
            disabled={imagePanel.working}
            onChange={(next) => { imagePanel.aspect = next as typeof imagePanel.aspect }}
          />
        </div>
      </section>

      <div class="field-group">
        <label for="image-style">Style</label>
        <UiSelect
          id="image-style"
          label="Style"
          value={imagePanel.style}
          options={imagePanel.styleOptions.map((option) => ({ value: option.value, label: option.label }))}
          disabled={imagePanel.working}
          onChange={(next) => { imagePanel.style = next as typeof imagePanel.style }}
        />
      </div>
      </div>
    </details>

    <details class="advanced-settings">
      <summary>Destination · {imagePanel.placement === 'media-bin' ? 'Media Bin' : 'Overlay'}</summary>
      <div class="advanced-body">
    <fieldset class="placement-group" disabled={imagePanel.working}>
      <legend>Destination</legend>
      <div class="placement-switch">
        <button type="button" class:active={imagePanel.placement === 'media-bin'} aria-pressed={imagePanel.placement === 'media-bin'} onclick={imagePanel.selectMediaBinPlacement}>Media Bin</button>
        <button type="button" class:active={imagePanel.placement === 'overlay'} aria-pressed={imagePanel.placement === 'overlay'} onclick={imagePanel.selectOverlayPlacement}>Overlay</button>
      </div>
      <p>{imagePanel.placement === 'media-bin' ? 'Create the asset without changing the timeline.' : 'Place the image above the current edit without cropping it.'}</p>
    </fieldset>

    {#if imagePanel.placement !== 'media-bin'}
      <div class="timing-grid">
        <label>Start <input type="number" min="0" step="any" value={imagePanel.start.toFixed(2)} onchange={imagePanel.updateStart} disabled={imagePanel.working} /></label>
        <label>Duration <input type="number" min="0.2" step="any" bind:value={imagePanel.duration} disabled={imagePanel.working} /></label>
      </div>
      <div class="treatment-grid">
        <label>Position
          <UiSelect
            label="Position"
            value={imagePanel.position}
            options={[{ value: 'left', label: 'Left' }, { value: 'center', label: 'Center' }, { value: 'right', label: 'Right' }]}
            disabled={imagePanel.working}
            onChange={(next) => { imagePanel.position = next as typeof imagePanel.position }}
          />
        </label>
        <label>Motion
          <UiSelect
            label="Motion"
            value={imagePanel.motion}
            options={[{ value: 'auto', label: 'Auto' }, { value: 'none', label: 'Static' }, { value: 'ken-burns', label: 'Ken Burns' }, { value: 'zoom-in', label: 'Slow push' }, { value: 'drift', label: 'Drift' }]}
            disabled={imagePanel.working}
            onChange={(next) => { imagePanel.motion = next as typeof imagePanel.motion }}
          />
        </label>
      </div>
    {/if}

      </div>
    </details>
    {#if imagePanel.mode === 'generate' && imagePanel.placement === 'overlay'}
      <details class="advanced-settings"><summary>Reusable recipe</summary>
      <RecipeSnippet title="Reuse image settings" description="Copy into the recipe document. The generated image is placed as an overlay when you compile." yaml={imageJobSnippet({ prompt: imagePanel.prompt, model: imagePanel.model, aspect: imagePanel.aspect, background: imagePanel.transparentBackground ? 'transparent' : 'opaque', imageStyle: IMAGE_STYLE_OPTIONS.find((option) => option.value === imagePanel.style)?.prompt, start: imagePanel.start, duration: Number(imagePanel.duration) })} />
      </details>
    {/if}

    <div class="action-dock">
      <button class="primary" type="submit" disabled={imagePanel.working || !imagePanel.prompt.trim() || imagePanel.mode === 'edit' && (!imagePanel.proxyEditingAvailable || !imagePanel.sourceName)}>
        {imagePanel.working ? 'Creating image…' : imagePanel.mode === 'edit' ? 'Edit image' : imagePanel.placement === 'media-bin' ? 'Generate to Media Bin' : 'Generate overlay'}
      </button>
      <span class="action-context">{imagePanel.placement === 'media-bin' ? 'Creates a new source without changing the timeline' : `Starts at ${imagePanel.start.toFixed(2)}s · ${Number(imagePanel.duration).toFixed(1)}s overlay`}</span>
    </div>

    {#if imagePanel.progress}
      <div class="result" class:done={!!imagePanel.resultUrl} role="status" aria-live="polite" aria-busy={imagePanel.working}>
        {#if imagePanel.resultUrl}<img src={imagePanel.resultUrl} alt="Generated result" />{/if}
        <span>{imagePanel.progress}</span>
      </div>
    {/if}
    {#if imagePanel.error}<div class="error" role="alert">{imagePanel.error}</div>{/if}
  </form>
</WorkbenchDialog>

<style>
  .image-workbench { display:flex; flex-direction:column; gap:var(--space-8); padding:var(--space-8); background:var(--surface); }
  .intent-strip { display:grid; grid-template-columns:40px minmax(0, 1fr); align-items:center; gap:var(--space-5); padding:var(--space-5) var(--space-6); border:1px solid var(--primary-border); border-radius:var(--radius-md); background:var(--primary-subtle); }
  .intent-mark { display:grid; width:40px; height:40px; place-items:center; border-radius:var(--radius-sm); color:var(--primary); background:var(--surface-elevated); }
  .intent-mark svg { width:22px; height:22px; fill:none; stroke:currentColor; stroke-width:1.5; stroke-linecap:round; stroke-linejoin:round; }
  .intent-strip p { margin:0; color:var(--foreground); font-size:var(--text-xs); line-height:var(--leading-copy); }
   .placement-switch { display:grid; padding:var(--space-1); border:1px solid var(--border); border-radius:var(--radius-md); background:var(--surface-muted); }
  .placement-switch { grid-template-columns:repeat(2, 1fr); }
   .placement-switch button { display:inline-flex; align-items:center; justify-content:center; gap:var(--space-3); min-height:var(--height-control-lg); padding:0 var(--space-5); border:0; border-radius:var(--radius-sm); background:transparent; color:var(--muted-foreground); font-size:var(--text-xs); font-weight:var(--weight-semibold); cursor:pointer; transition:background-color 140ms ease, color 140ms ease, box-shadow 140ms ease; }
   .placement-switch button:hover:not(:disabled) { color:var(--foreground); background:var(--surface-elevated); }
   .placement-switch button.active { color:var(--primary-foreground); background:var(--primary); box-shadow:var(--shadow-object); }
   .placement-switch button:focus-visible { outline:none; box-shadow:var(--focus-ring); }
  .field-group { display:flex; flex-direction:column; gap:var(--space-4); min-width:0; }
   .field-head { display:flex; align-items:center; justify-content:space-between; gap:var(--space-6); }
   .field-head span { color:var(--muted-foreground); font:var(--text-2xs)/1 var(--font-mono); text-transform:uppercase; }
  label, legend { color:var(--foreground); font-size:var(--text-xs); font-weight:var(--weight-semibold); }
  .generation-grid { display:grid; grid-template-columns:minmax(0, 1.4fr) minmax(96px, .6fr); gap:var(--space-6); }
  .generation-field { display:flex; min-width:0; flex-direction:column; gap:var(--space-3); }
  .field-note { color:var(--muted-foreground); font:var(--text-2xs)/var(--leading-ui) var(--font-sans); font-weight:var(--weight-normal); overflow-wrap:anywhere; }
  .background-group { gap:var(--space-3); padding:var(--space-5) var(--space-6); border:1px solid var(--border); border-radius:var(--radius-md); background:var(--surface-muted); }
  .background-choice { display:grid; grid-template-columns:18px minmax(0, 1fr); align-items:start; gap:var(--space-4); cursor:pointer; }
  .background-choice input { appearance:none; width:18px; height:18px; margin:0; border:1px solid var(--border-strong); border-radius:var(--radius-xs); background:var(--input); cursor:pointer; }
  .background-choice input:checked { border-color:var(--primary); background-color:var(--primary); background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='m2 6 2.5 2.5L10 3' fill='none' stroke='%23fff' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.8'/%3E%3C/svg%3E"); background-position:center; background-repeat:no-repeat; background-size:12px; }
  .background-choice span { display:flex; min-width:0; flex-direction:column; gap:var(--space-1); }
  .background-choice strong { font-size:var(--text-xs); font-weight:var(--weight-semibold); }
  .background-choice small { color:var(--muted-foreground); font-size:var(--text-2xs); font-weight:var(--weight-normal); line-height:var(--leading-ui); }
  textarea, input[type='number'] { width:100%; min-height:var(--height-control); border:1px solid var(--border); border-radius:var(--radius-sm); background-color:var(--surface-elevated); color:var(--foreground); font:var(--text-xs)/var(--leading-ui) var(--font-sans); transition:border-color 140ms ease, box-shadow 140ms ease, background-color 140ms ease; }
   textarea { min-height:60px; padding:var(--space-4); resize:vertical; line-height:var(--leading-copy); }
  input[type='number'] { padding:0 var(--space-5); }
  textarea::placeholder { color:var(--muted-foreground); }
  textarea:focus-visible, input:focus-visible, button:focus-visible { outline:none; border-color:var(--primary); box-shadow:var(--focus-ring); }
  .source-row { display:grid; grid-template-columns:minmax(0, 1fr) auto; gap:var(--space-4); }
  .source-preview { display:grid; place-items:center; min-height:140px; max-height:220px; overflow:hidden; border:1px solid var(--border); border-radius:var(--radius-md); background:var(--surface-muted); }
  .source-preview img { display:block; width:100%; height:100%; max-height:220px; object-fit:contain; }
  .source-group .mode-note { margin:0; }
  .secondary, .primary { display:inline-flex; align-items:center; justify-content:center; gap:var(--space-3); min-height:var(--height-control-lg); padding:0 var(--space-8); border:1px solid var(--border); border-radius:var(--radius-sm); font-size:var(--text-xs); font-weight:var(--weight-semibold); line-height:1; cursor:pointer; transition:border-color 140ms ease, background-color 140ms ease, color 140ms ease, transform 140ms ease; }
  .secondary { background:var(--surface-elevated); color:var(--secondary-foreground); }
  .secondary:hover:not(:disabled) { border-color:var(--primary-border); background:var(--primary-subtle); color:var(--primary); }
  .secondary svg { width:16px; height:16px; fill:none; stroke:currentColor; stroke-width:1.5; stroke-linecap:round; stroke-linejoin:round; }
  .primary { border-color:var(--primary); background:var(--primary); color:var(--primary-foreground); }
  .primary:hover:not(:disabled) { background:var(--primary-hover); }
  .secondary:active:not(:disabled), .primary:active:not(:disabled) { transform:translateY(1px); }
  button:disabled, textarea:disabled, input:disabled { opacity:.5; cursor:not-allowed; }
  .placement-group { display:flex; flex-direction:column; gap:var(--space-4); min-width:0; margin:0; padding:var(--space-6); border:1px solid var(--border); border-radius:var(--radius-md); background:var(--surface-muted); }
  .placement-group p, .mode-note { margin:0; color:var(--muted-foreground); font-size:var(--text-2xs); line-height:var(--leading-copy); }
  .timing-grid, .treatment-grid { display:grid; grid-template-columns:1fr 1fr; gap:var(--space-6); }
  .timing-grid label, .treatment-grid label { display:flex; flex-direction:column; gap:var(--space-3); }
  .treatment-grid label:only-child { grid-column:1 / -1; }
  .action-dock { position:sticky; bottom:0; z-index:2; display:flex; flex-direction:column; gap:var(--space-3); margin:calc(var(--space-3) * -1) calc(var(--space-8) * -1) 0; padding:var(--space-5) var(--space-8) var(--space-4); border-top:1px solid var(--border); background:var(--surface); box-shadow:0 -10px 18px rgb(22 29 36 / 8%); }
  .action-dock .primary { width:100%; }
  .action-context { color:var(--muted-foreground); font:var(--text-2xs)/1 var(--font-mono); text-align:center; }
  .result { display:grid; grid-template-columns:auto minmax(0, 1fr); align-items:center; gap:var(--space-6); padding:var(--space-5); border:1px solid var(--primary-border); border-radius:var(--radius-md); background:var(--primary-subtle); color:var(--foreground); font-size:var(--text-xs); }
  .result.done { border-color:var(--success); background:var(--success-subtle); }
  .result img { width:64px; height:48px; object-fit:contain; border:1px solid var(--border); border-radius:var(--radius-sm); background:var(--surface-muted); }
  .error { padding:var(--space-5); border:1px solid var(--destructive); border-radius:var(--radius-md); background:var(--destructive-subtle); color:var(--foreground); font-size:var(--text-xs); line-height:var(--leading-ui); }
  @media (max-width:760px) { .image-workbench { padding:var(--space-6); } .generation-grid, .timing-grid, .treatment-grid { grid-template-columns:1fr; } .treatment-grid label:only-child { grid-column:auto; } .source-row { grid-template-columns:1fr; } .secondary.upload { width:100%; } .action-dock { margin-inline:calc(var(--space-6) * -1); padding-inline:var(--space-6); } }
   @media (pointer:coarse) { .placement-switch button, input[type='number'] { min-height:40px; } }
</style>
