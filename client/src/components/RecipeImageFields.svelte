<script lang="ts">
  import UiSelect from './UiSelect.svelte'
  import RecipeActionTiming from './RecipeActionTiming.svelte'
  import { AI_IMAGE_MODELS } from '../lib/api'
  import { IMAGE_STYLE_OPTIONS } from '../lib/image-panel'
  import type { ImageAction } from '../lib/recipe-action-fields'

  let { action = $bindable() }: { action: ImageAction } = $props()
  const model = $derived(AI_IMAGE_MODELS.find((item) => item.id === action.model) ?? AI_IMAGE_MODELS[0])

  function selectModel(id: string): void {
    action.model = id
    const next = AI_IMAGE_MODELS.find((item) => item.id === id)!
    if (!(next.aspects as readonly string[]).includes(action.aspect)) action.aspect = next.aspects[0]
    if (!next.transparent) action.background = 'opaque'
  }

  function updateScale(event: Event): void {
    const scale = (event.currentTarget as HTMLInputElement).valueAsNumber / 100
    action.transform.zoomX = scale
    action.transform.zoomY = scale
    action.transform.linkZoom = true
  }
</script>

<section class="form-section">
  <h4>Image content</h4>
  <label class="field" for="recipe-image-prompt">Describe the image
    <textarea id="recipe-image-prompt" bind:value={action.prompt} required maxlength="4000" placeholder="A sunlit coastal town, seen from above…"></textarea>
  </label>
  <div class="field-row">
    <div class="field"><label for="recipe-image-model">AI model</label>
      <UiSelect id="recipe-image-model" label="Image AI model" value={action.model} options={AI_IMAGE_MODELS.map((item) => ({ value: item.id, label: item.label }))} onChange={selectModel} />
    </div>
    <div class="field"><label for="recipe-image-aspect">Aspect ratio</label>
      <UiSelect id="recipe-image-aspect" label="Image aspect ratio" value={action.aspect} options={model.aspects.map((value) => ({ value, label: value === 'auto' ? 'Auto' : value }))} onChange={(value) => { action.aspect = value }} />
    </div>
  </div>
  <p class="field-note">{model.price} · {model.output}</p>
  <div class="field-row">
    <div class="field"><label for="recipe-image-background">Background</label>
      <UiSelect id="recipe-image-background" label="Image background" value={action.background} options={[{ value: 'opaque', label: 'Full background' }, { value: 'transparent', label: 'Transparent PNG', disabled: !model.transparent }, { value: 'auto', label: 'Auto' }]} onChange={(value) => { action.background = value }} />
    </div>
    <div class="field"><label for="recipe-image-style">Visual style</label>
      <UiSelect id="recipe-image-style" label="Image visual style" value={action.imageStyle} options={[{ value: '', label: 'Use the description' }, ...IMAGE_STYLE_OPTIONS.map((item) => ({ value: item.prompt, label: item.label })), ...(action.imageStyle && !IMAGE_STYLE_OPTIONS.some((item) => item.prompt === action.imageStyle) ? [{ value: action.imageStyle, label: 'Custom style' }] : [])]} onChange={(value) => { action.imageStyle = value }} />
    </div>
  </div>
</section>

<section class="form-section">
  <h4>Placement</h4>
  <div class="field"><label for="recipe-image-destination">Destination</label>
    <UiSelect id="recipe-image-destination" label="Image destination" value={action.destination} options={[{ value: 'timeline', label: 'Overlay on the timeline' }, { value: 'media-bin', label: 'Media Bin only' }]} onChange={(value) => { action.destination = value as ImageAction['destination'] }} />
  </div>
  {#if action.destination === 'timeline'}
    <RecipeActionTiming bind:action />
    <div class="field-row position-row">
      <label class="field" for="recipe-image-x">Horizontal position (%)<input id="recipe-image-x" type="number" min="-100" max="100" step="any" required bind:value={action.transform.positionX} /></label>
      <label class="field" for="recipe-image-y">Vertical position (%)<input id="recipe-image-y" type="number" min="-100" max="100" step="any" required bind:value={action.transform.positionY} /></label>
      <label class="field" for="recipe-image-scale">Scale (%)<input id="recipe-image-scale" type="number" min="1" max="4000" step="any" required value={Number((action.transform.zoomX * 100).toFixed(3))} oninput={updateScale} /></label>
    </div>
    <p class="field-note">0% centers the image. Negative horizontal values move it left; positive values move it right.</p>
  {:else}
    <p class="field-note">Generate the image without placing a clip in the timeline.</p>
  {/if}
</section>
