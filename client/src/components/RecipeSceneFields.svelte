<script lang="ts">
  import UiSelect from './UiSelect.svelte'
  import type { SceneAction } from '../lib/recipe-action-fields'
  import type { CompositionAsset } from '../lib/composition-types'
  import { isLiveSceneFile } from '../lib/live-scene'

  let { action = $bindable(), assets }: { action: SceneAction; assets: CompositionAsset[] } = $props()
  const sources = $derived(assets.filter(asset => !asset.local && isLiveSceneFile(asset.file)))
</script>

<section class="form-section">
  <h4>Scene content</h4>
  <div class="field"><label for="recipe-scene-operation">Action</label>
    <UiSelect id="recipe-scene-operation" label="Scene action" value={action.operation} options={[{ value: 'generate', label: 'Generate a new scene' }, { value: 'edit', label: 'Edit an existing scene' }]} onChange={(value) => { action.operation = value as SceneAction['operation'] }} />
  </div>
  {#if action.operation === 'edit'}
    <div class="field"><label for="recipe-scene-source">Scene to edit</label>
      <UiSelect id="recipe-scene-source" label="Scene to edit" value={action.assetId} options={[{ value: '', label: 'Choose a live scene…' }, ...sources.map(asset => ({ value: asset.id, label: asset.file }))]} onChange={(value) => { action.assetId = value }} />
    </div>
    {#if !sources.length}<p class="field-note">Generate a scene and add it to the timeline first to make its source available in this recipe.</p>{/if}
  {/if}
  <label class="field" for="recipe-scene-prompt">{action.operation === 'edit' ? 'Describe the changes' : 'Describe the animation'}
    <textarea id="recipe-scene-prompt" required maxlength="4000" bind:value={action.prompt} placeholder={action.operation === 'edit' ? 'Keep the layout, change the colors and slow down the final reveal…' : 'A seed grows into a tree, with roots spreading and branches unfolding…'}></textarea>
  </label>
  <div class="field-row">
    <label class="field" for="recipe-scene-duration">Scene length (seconds)<input id="recipe-scene-duration" type="number" min="1" max="60" step="any" required bind:value={action.duration} /></label>
    {#if action.operation === 'generate'}
      <div class="field"><label for="recipe-scene-aspect">Aspect ratio</label>
        <UiSelect id="recipe-scene-aspect" label="Scene aspect ratio" value={action.aspect} options={[{ value: '', label: 'Match the project' }, { value: '16:9', label: '16:9' }, { value: '9:16', label: '9:16' }, { value: '4:3', label: '4:3' }]} onChange={(value) => { action.aspect = value }} />
      </div>
    {/if}
  </div>
  <p class="field-note">{action.operation === 'edit' ? 'Keeps the existing component’s format, images and voice.' : 'Creates a live Svelte component. FPS follows the project; video renders at export.'}</p>
</section>

<section class="form-section">
  <h4>Placement</h4>
  <div class="field"><label for="recipe-scene-destination">Destination</label>
    <UiSelect id="recipe-scene-destination" label="Scene destination" value={action.destination} options={[{ value: 'timeline', label: 'Scene on the timeline' }, { value: 'media-bin', label: 'Media Bin only' }]} onChange={(value) => { action.destination = value as SceneAction['destination'] }} />
  </div>
  {#if action.destination === 'timeline'}
    <label class="field" for="recipe-scene-start">Start (seconds)<input id="recipe-scene-start" type="number" min="0" max="86400" step="any" required bind:value={action.start} /></label>
  {/if}
</section>
