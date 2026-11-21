<script lang="ts">
  import type { ImageAction, TextAction, VoiceAction } from '../lib/recipe-action-fields'
  let { action = $bindable() }: { action: ImageAction | TextAction | VoiceAction } = $props()
</script>

<div class="field-row">
  <label class="field" for="recipe-action-start">Start (seconds)
    <input id="recipe-action-start" type="number" min="0" max="86400" step="any" required bind:value={action.start} />
  </label>
  {#if action.kind !== 'voice'}
    <label class="field" for="recipe-action-duration">Duration (seconds)
      <input id="recipe-action-duration" type="number" min="0.1" max="86400" step="any" required bind:value={action.duration} />
    </label>
  {:else}
    <p class="field-note timing-note">The narration uses the full duration of the generated audio.</p>
  {/if}
</div>
