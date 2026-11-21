<script lang="ts">
  import UiSelect from './UiSelect.svelte'
  import RecipeActionTiming from './RecipeActionTiming.svelte'
  import { DEFAULT_SPEECH_MODEL, SPEECH_MODELS, voiceLabel } from '../lib/speech'
  import type { VoiceAction } from '../lib/recipe-action-fields'
  import type { CompositionAsset } from '../lib/composition-types'

  let { action = $bindable(), assets }: { action: VoiceAction; assets: CompositionAsset[] } = $props()
  const model = $derived(SPEECH_MODELS.find((item) => item.id === action.model) ?? SPEECH_MODELS.find((item) => item.id === DEFAULT_SPEECH_MODEL)!)
  const references = $derived(assets.filter((asset) => !asset.local && asset.kind === 'audio' && /\.mp3$/i.test(asset.file)))

  function selectModel(id: string): void {
    action.model = id
    const next = SPEECH_MODELS.find((item) => item.id === id)!
    if (!next.cloning || !next.voices.length) action.voiceMode = next.voices.length ? 'preset' : 'clone'
    if (!(next.voices as readonly string[]).includes(action.voice)) action.voice = next.voices[0] ?? ''
  }
</script>

<section class="form-section">
  <h4>Voice content</h4>
  <label class="field" for="recipe-voice-script">Script
    <textarea id="recipe-voice-script" bind:value={action.text} required maxlength="4000" placeholder="Write the words the voice should say…"></textarea>
  </label>
  <div class="field"><label for="recipe-voice-model">AI model</label>
    <UiSelect id="recipe-voice-model" label="Speech AI model" value={action.model} options={SPEECH_MODELS.map((item) => ({ value: item.id, label: item.label }))} onChange={selectModel} />
  </div>
  <p class="field-note">{model.detail}</p>
  <div class="field"><label for="recipe-voice-source">Voice source</label>
    <UiSelect id="recipe-voice-source" label="Voice source" value={action.voiceMode} options={[{ value: 'preset', label: 'Built-in voice', disabled: !model.voices.length }, { value: 'clone', label: 'Server voice sample', disabled: !model.cloning }]} onChange={(value) => { action.voiceMode = value as VoiceAction['voiceMode'] }} />
  </div>
  {#if action.voiceMode === 'preset'}
    <div class="field"><label for="recipe-voice-preset">Built-in voice</label>
      <UiSelect id="recipe-voice-preset" label="Built-in voice" value={action.voice} options={model.voices.map((voice) => ({ value: voice, label: voiceLabel(voice) }))} onChange={(value) => { action.voice = value }} />
    </div>
  {:else}
    <div class="field"><label for="recipe-voice-reference">Voice sample</label>
      <UiSelect id="recipe-voice-reference" label="Voice sample" value={action.referenceName} options={[...references.map((asset) => ({ value: asset.file, label: asset.file })), ...(action.referenceName && !references.some((asset) => asset.file === action.referenceName) ? [{ value: action.referenceName, label: action.referenceName }] : [])]} placeholder="Choose a server MP3" onChange={(value) => { action.referenceName = value }} />
    </div>
    <p class="field-note">Use a voice sample already uploaded through the Speech panel.</p>
    <label class="field" for="recipe-voice-transcript">Sample transcript <span class="optional">optional</span>
      <textarea id="recipe-voice-transcript" class="short-textarea" bind:value={action.referenceTranscript} maxlength="4000" placeholder="The words spoken in the sample…"></textarea>
    </label>
  {/if}
</section>

<section class="form-section">
  <h4>Placement</h4>
  <div class="field"><label for="recipe-voice-destination">Destination</label>
    <UiSelect id="recipe-voice-destination" label="Voice destination" value={action.destination} options={[{ value: 'timeline', label: 'Narration track' }, { value: 'media-bin', label: 'Media Bin only' }]} onChange={(value) => { action.destination = value as VoiceAction['destination'] }} />
  </div>
  {#if action.destination === 'timeline'}<RecipeActionTiming bind:action />{/if}
</section>
