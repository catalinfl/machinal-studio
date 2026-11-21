<script lang="ts">
  import { EDITOR_WORKFLOWS, type EditorWorkflow } from '../lib/editor-workflows'
  let { onAddMedia, onGenerateScenes, onStartWorkflow }: { onAddMedia: () => void; onGenerateScenes?: () => void; onStartWorkflow?: (workflow: EditorWorkflow) => void } = $props()
  let choices = $state<HTMLDivElement>()
</script>

<div class="preview-onboarding">
  <svg class="empty-composition" viewBox="0 0 48 48" aria-hidden="true"><rect x="5" y="9" width="38" height="30" rx="1" /><path d="M5 17h38M13 9l5 8M25 9l5 8m-10 6 10 6-10 6z" /></svg>
  <h2>Make room for your next idea.</h2>
  <p>Bring in your media, or create a scene.<br />Arrange clips below. See your edit take shape here.</p>
  <div class="start-actions">
    <button type="button" class="start-media" onclick={onAddMedia}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12" /></svg>Open media library</button>
    {#if onGenerateScenes}<button type="button" class="start-scene" onclick={onGenerateScenes}>Create a scene<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h12m-5-5 5 5-5 5" /></svg></button>{/if}
  </div>
  {#if onStartWorkflow}
    <button class="quick-start" popovertarget="editor-workflow-choices">Start with a guided workflow</button>
    <div id="editor-workflow-choices" class="workflow-choices" popover="auto" bind:this={choices} role="group" aria-label="Guided starting points">
      {#each EDITOR_WORKFLOWS as workflow (workflow.id)}<button onclick={() => { choices?.hidePopover(); onStartWorkflow?.(workflow.id) }}><strong>{workflow.name}</strong><span>{workflow.detail}</span></button>{/each}
    </div>
  {/if}
</div>

<style>
  .quick-start { pointer-events: auto; margin-top: 12px; min-height: 36px; padding: 6px 10px; border: 0; background: transparent; font: inherit; font-size: 12px; color: var(--foreground); cursor: pointer; }
  .workflow-choices { position: fixed; inset: 0; margin: auto; width: min(360px, calc(100vw - 24px)); height: fit-content; max-height: calc(100dvh - 40px); overflow: auto; padding: 8px; border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--surface-elevated); color: var(--foreground); box-shadow: var(--shadow-dialog); }
  .workflow-choices button { display: block; width: 100%; min-height: 64px; padding: 10px 12px; border: 0; border-bottom: 1px solid var(--border); color: var(--foreground); background: var(--surface); cursor: pointer; text-align: left; font: inherit; font-size: 12px; }
  strong, span { display: block; }
  span { color: var(--muted-foreground); margin-top: 4px; }
  button:hover { background: var(--primary-subtle); }
  button:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
</style>
