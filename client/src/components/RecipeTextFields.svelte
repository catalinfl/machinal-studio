<script lang="ts">
  import UiSelect from './UiSelect.svelte'
  import RecipeActionTiming from './RecipeActionTiming.svelte'
  import { TEXT_PANEL_PRESETS, SHORT_FORM_TEXT_PRESETS, BANNER_TEXT_PRESETS } from '../lib/text-presets'
  import type { TextAction } from '../lib/recipe-action-fields'

  let { action = $bindable() }: { action: TextAction } = $props()
  const presets = [...TEXT_PANEL_PRESETS, ...SHORT_FORM_TEXT_PRESETS, ...BANNER_TEXT_PRESETS].filter((item) => item.id && item.values.highlightMode !== 'word')

  function selectPreset(id: string): void {
    action.preset = id
    const values = presets.find((item) => item.id === id)?.values
    if (!values) return
    action.presetValues = { ...values }
    action.x = values.x ?? action.x
    action.y = values.y ?? action.y
    action.fontSize = values.fontSize ?? action.fontSize
    action.color = values.color ?? action.color
  }
</script>

<section class="form-section">
  <h4>Text content</h4>
  <label class="field" for="recipe-text-content">Text
    <textarea id="recipe-text-content" bind:value={action.text} required placeholder="Your title, label or message…"></textarea>
  </label>
  <div class="field"><label for="recipe-text-style">Style</label>
    <UiSelect id="recipe-text-style" label="Text style" value={action.preset} options={[{ value: '', label: 'Custom style (keep current)' }, ...presets.map((item) => ({ value: item.id!, label: item.label }))]} onChange={selectPreset} />
  </div>
  <div class="field-row">
    <label class="field" for="recipe-text-size">Font size<input id="recipe-text-size" type="number" min="8" max="600" step="any" required bind:value={action.fontSize} /></label>
    <label class="field" for="recipe-text-color">Text color<input id="recipe-text-color" type="color" bind:value={action.color} /></label>
  </div>
</section>

<section class="form-section">
  <h4>Placement</h4>
  <RecipeActionTiming bind:action />
  <div class="field-row">
    <label class="field" for="recipe-text-x">Horizontal position<input id="recipe-text-x" type="number" min="-3840" max="7680" step="any" required bind:value={action.x} /></label>
    <label class="field" for="recipe-text-y">Vertical position<input id="recipe-text-y" type="number" min="-3840" max="7680" step="any" required bind:value={action.y} /></label>
  </div>
  <p class="field-note">Uses the editor’s 1920 × 1080 text coordinate space. 960, 540 is the center.</p>
</section>
