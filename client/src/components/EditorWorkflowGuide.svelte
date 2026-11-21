<script lang="ts">
  import { editor } from '../stores/editor.svelte'
  import { EDITOR_WORKFLOWS, type EditorWorkflow } from '../lib/editor-workflows'
  let { workflow, onMedia, onSpeech, onCaptions, onReviewCaptions, onDismiss }: { workflow: EditorWorkflow; onMedia: () => void; onSpeech: () => void; onCaptions: () => void; onReviewCaptions: () => void; onDismiss: () => void } = $props()
  const selected = $derived(EDITOR_WORKFLOWS.find(item => item.id === workflow)!)
  const hasMedia = $derived(editor.channels.some(channel => channel.clips.length > 0))
  const hasAudio = $derived(editor.channels.some(channel => channel.type === 'audio' && channel.clips.length > 0))
  const hasCaptions = $derived(editor.textItems.some(item => item.isCaption))
</script>

<aside aria-label="Guided workflow">
  <strong>{selected.name}</strong>
  <div class="steps">
    {#if workflow === 'narrated'}<button onclick={onSpeech}>{hasAudio ? 'Voice ready · speech tools' : 'Write and generate narration'}</button>{/if}
    <button onclick={onMedia}>{hasMedia ? 'Add more media' : 'Import your media'}</button>
    {#if workflow === 'reel'}<button disabled={!hasAudio && !hasCaptions} onclick={hasCaptions ? onReviewCaptions : onCaptions}>{hasCaptions ? 'Review captions in Text' : 'Generate captions'}</button>{/if}
    <span>{hasMedia ? 'Arrange and trim below, then use Render to export.' : 'Add sources to the timeline to continue.'}</span>
  </div>
  <button class="dismiss" onclick={onDismiss} aria-label="Dismiss guided workflow">Dismiss guide</button>
</aside>

<style>
  aside { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; padding: 8px 16px; background: var(--surface); color: var(--foreground); border-bottom: 1px solid var(--border); font-size: 12px; }
  .steps { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; flex: 1; }
  span { color: var(--muted-foreground); }
  button { min-height: 36px; padding: 6px 10px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--input); color: var(--foreground); font: inherit; cursor: pointer; }
  .dismiss { border-color: transparent; background: transparent; }
  button:hover:not(:disabled) { background: var(--primary-subtle); }
  button:disabled { opacity: .5; cursor: not-allowed; }
  button:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
</style>
