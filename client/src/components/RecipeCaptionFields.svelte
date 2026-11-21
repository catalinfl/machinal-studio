<script lang="ts">
  import UiSelect from './UiSelect.svelte'
  import { SHORT_FORM_TEXT_PRESETS, captionStyleForPreset } from '../lib/text-presets'
  import type { CaptionsAction } from '../lib/recipe-action-fields'
  import type { CompositionAsset } from '../lib/composition-types'

  let { action = $bindable(), assets }: { action: CaptionsAction; assets: CompositionAsset[] } = $props()
  const sources = $derived(assets.filter((asset) => !asset.local && (asset.kind === 'audio' || asset.kind === 'video' && asset.hasAudio)))

  function selectStyle(id: string): void {
    action.preset = id
    const preset = SHORT_FORM_TEXT_PRESETS.find((item) => item.id === id)
    action.style = preset ? captionStyleForPreset(preset) : {}
  }
</script>

<section class="form-section">
  <h4>Caption source</h4>
  <div class="field"><label for="recipe-captions-source">Audio to transcribe</label>
    <UiSelect id="recipe-captions-source" label="Caption audio source" value={action.assetId} options={[{ value: '', label: 'Resulting edit (includes generated narration)' }, ...sources.map((asset) => ({ value: asset.id, label: asset.file })), ...(action.assetId && !sources.some((asset) => asset.id === action.assetId) ? [{ value: action.assetId, label: action.assetId }] : [])]} onChange={(value) => { action.assetId = value }} />
  </div>
  <p class="field-note">Runs after image and voice actions, using the final clip timing. Local audio must be uploaded first.</p>
  <div class="field-row">
    <div class="field"><label for="recipe-captions-language">Spoken language</label>
      <UiSelect id="recipe-captions-language" label="Caption language" value={action.language} options={[{ value: 'auto', label: 'Detect automatically' }, { value: 'ro', label: 'Romanian' }]} searchable searchPlaceholder="Search languages..." onChange={(value) => { action.language = value }} />
    </div>
    <label class="field" for="recipe-captions-words">Words per caption<input id="recipe-captions-words" type="number" min="1" max="50" step="1" required bind:value={action.maxWords} /></label>
  </div>
</section>

<section class="form-section">
  <h4>Caption appearance</h4>
  <div class="field"><label for="recipe-captions-style">Style</label>
    <UiSelect id="recipe-captions-style" label="Caption style" value={action.preset} options={[{ value: '', label: Object.keys(action.style).length ? 'Custom style (keep current)' : 'Default captions' }, ...SHORT_FORM_TEXT_PRESETS.map((item) => ({ value: item.id, label: item.label }))]} onChange={selectStyle} />
  </div>
  <p class="field-note">Word-highlight styles use actual speech timestamps. The language setting does not translate speech.</p>
</section>
