<script lang="ts">
  import type { EditorPanel } from '../composables/useEditorPage.svelte'
  import EditorToolIcon from './EditorToolIcon.svelte'

  let { active, busy, onSelect }: {
    active: EditorPanel
    busy: boolean
    onSelect: (panel: EditorPanel) => void
  } = $props()

  const tools: { id: EditorPanel; label: string; accessible: string }[] = [
    { id: 'media', label: 'Media', accessible: 'Media Bin' },
    { id: 'text', label: 'Text', accessible: 'Text' },
    { id: 'effects', label: 'Effects', accessible: 'Effects' },
    { id: 'presets', label: 'Styles', accessible: 'Styles' },
    { id: 'transitions', label: 'Transitions', accessible: 'Transitions' },
    { id: 'speech', label: 'Speech', accessible: 'Speech' },
    { id: 'image', label: 'Image', accessible: 'Image' },
    { id: 'ai', label: 'AI Edit', accessible: 'AI Edit' },
  ]
</script>

<div class="editor-taskbar">
  <nav aria-label="Editor tools">
    {#each tools as tool (tool.id)}
      <button type="button" class:active={active === tool.id} aria-label={tool.accessible} aria-current={active === tool.id ? 'page' : undefined} disabled={tool.id === 'media' && busy} onclick={() => onSelect(tool.id)}>
        <EditorToolIcon tool={tool.id} /><span>{tool.label}</span>
      </button>
    {/each}
  </nav>
</div>
