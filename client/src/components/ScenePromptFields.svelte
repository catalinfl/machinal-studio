<script lang="ts">
  import type { SceneGeneration } from '../composables/useSceneGeneration.svelte'
  import SceneImageAttachments from './SceneImageAttachments.svelte'
  import SceneVideoAttachments from './SceneVideoAttachments.svelte'

  let { generation }: { generation: SceneGeneration } = $props()
</script>

<div class="prompt-fields">
  <label for="scene-text">Text to display (optional)</label>
  <textarea id="scene-text" bind:value={generation.draft.text} maxlength="4000" rows="2" disabled={generation.busy} placeholder="The exact title, message or words to show in the scene…"></textarea>
  <p class="field-help">AI keeps this wording separate from your visual instructions.</p>
  <label for="scene-prompt">{generation.draft.mode === 'voice' ? 'Visual direction (optional)' : 'What should happen in this scene?'}</label>
   <textarea id="scene-prompt" bind:value={generation.draft.prompt} maxlength="4000" rows={generation.draft.mode === 'voice' ? 3 : 4} disabled={generation.busy} placeholder={generation.draft.transparent ? 'A hand-drawn arrow traces a curve, then sparkles appear around its tip. Keep everything else transparent.' : generation.draft.visualMode === '3d' ? 'A 3D planet rotates as the camera moves around it. Add soft lighting and reveal the title above it.' : generation.draft.mode === 'voice' ? 'Use hand-drawn diagrams and animate each idea as I explain it…' : 'A small seed grows into a tree. Show the roots spreading, then the branches unfolding, with warm colors and a gentle camera move.'}></textarea>
  <p class="field-help">Describe the layout, motion, camera and effects. These instructions are not on-screen text.</p>
  <SceneImageAttachments {generation} />
  <SceneVideoAttachments {generation} />
</div>

<style>
  .prompt-fields { display:flex; flex-direction:column; gap:var(--space-4); min-width:0; }
  label { display:block; font-size:var(--text-xs); font-weight:var(--weight-semibold); }
  textarea { width:100%; min-width:0; resize:vertical; padding:var(--space-5) var(--space-6); border:1px solid var(--border); border-radius:var(--radius-sm); background:var(--input); color:var(--foreground); font:var(--text-sm)/var(--leading-copy) var(--font-sans); caret-color:var(--primary); }
  textarea::placeholder { color:var(--muted-foreground); opacity:1; }
  textarea:focus-visible { outline:2px solid var(--ring); outline-offset:2px; }
  textarea:disabled { opacity:.55; cursor:not-allowed; }
  .field-help { margin:0; color:var(--muted-foreground); font-size:var(--text-xs); line-height:var(--leading-copy); }
  ::selection { color:var(--primary-foreground); background:var(--primary); }
</style>
