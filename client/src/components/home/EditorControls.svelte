<script lang="ts">
  import type { LandingEditor } from '../../composables/useLandingEditor.svelte'
  import { DEMO_SCENES, demoLooks, demoEffects, demoTransitions, type DemoTool } from '../../lib/landing'
  import LandingIcon from './LandingIcon.svelte'

  let { editor, tool = $bindable<DemoTool>('media') }: { editor: LandingEditor; tool?: DemoTool } = $props()
  const tools: { id: DemoTool; name: string }[] = [
    { id: 'media', name: 'Media' }, { id: 'styles', name: 'Styles' },
    { id: 'effects', name: 'Effects' }, { id: 'transitions', name: 'Transitions' }, { id: 'text', name: 'Text' },
  ]

  function dragScene(event: DragEvent, id: string) {
    event.dataTransfer?.setData('application/x-direction-demo', `scene:${id}`)
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy'
  }
</script>

<div class="editor-controls">
  <div class="pane-heading"><LandingIcon name="layers" size={17} /><span>Make it visual.</span><a href="/editor" aria-label="Open the full editor"><LandingIcon name="direction" size={15} /></a></div>
  <div class="tool-tabs" role="group" aria-label="Sandbox tools">{#each tools as option}<button class:active={tool === option.id} aria-pressed={tool === option.id} onclick={() => tool = option.id}>{option.name}</button>{/each}</div>
  <div class="tool-body">
    {#if tool === 'media'}
      <p class="tool-instruction">Add a scene. Make it yours.</p>
      {#each DEMO_SCENES as scene}
        {@const added = editor.project.clips.some(clip => clip.id === scene.id)}
        <button class="scene-item" draggable="true" ondragstart={(event) => dragScene(event, scene.id)} onclick={() => editor.addScene(scene.id)} aria-label={added ? `Select ${scene.label}` : `Add ${scene.label} to timeline`}>
          <span class="scene-thumbnail" style:background={scene.ground} style:color={scene.ink}><LandingIcon name="direction" size={23} /></span>
          <span>{scene.label}<small>{added ? 'On the timeline' : 'Click or drag to add'}</small></span>
          <span class="scene-add">{#if added}<LandingIcon name="check" size={14} />{:else}+{/if}</span>
        </button>
      {/each}
    {:else if tool === 'styles'}
      <p class="tool-instruction">A complete look for your selected clip.</p>
      {#each demoLooks as look}<button class="preset" class:active={editor.selected.look === look.id} aria-pressed={editor.selected.look === look.id} onclick={() => editor.applyPreset('look', look.id)}><span>{look.label}<small>{look.category}</small></span><LandingIcon name="direction" size={15} /></button>{/each}
      <button class="reset-preset" onclick={() => editor.applyPreset('look', null)}>Remove style</button>
    {:else if tool === 'effects'}
      <p class="tool-instruction">Same presets. Same live preview engine.</p>
      {#each demoEffects as effect}<button class="preset" class:active={editor.selected.effect === effect.id} aria-pressed={editor.selected.effect === effect.id} onclick={() => editor.applyPreset('effect', effect.id)}><span>{effect.label}<small>{effect.summary}</small></span><LandingIcon name="direction" size={15} /></button>{/each}
      <button class="reset-preset" onclick={() => editor.applyPreset('effect', null)}>Remove effect</button>
    {:else if tool === 'transitions'}
      <p class="tool-instruction">{editor.project.clips.length < 2 ? 'Add a second scene to connect two clips.' : 'Choose how one scene becomes the next.'}</p>
      {#each demoTransitions as transition}<button class="preset" disabled={editor.project.clips.length < 2} class:active={editor.project.transition === transition.id} aria-pressed={editor.project.transition === transition.id} onclick={() => editor.applyTransition(transition.id)}><span>{transition.label}<small>0.6 second overlap</small></span><LandingIcon name="direction" size={15} /></button>{/each}
      <button class="reset-preset" disabled={!editor.project.transition} onclick={() => editor.applyTransition(null)}>Use a straight cut</button>
    {:else}
      <p class="tool-instruction">Give your idea a title.</p>
      <button class="add-title" onclick={editor.toggleTitle}>{editor.project.title === null ? 'Add title to timeline' : 'Remove title'}<LandingIcon name="captions" size={17} /></button>
      {#if editor.project.title !== null}<label class="title-field">Your words<input maxlength="42" aria-label="Edit sandbox title" bind:value={editor.project.title} /></label>{/if}
      <p class="text-note">Explore styled titles, word-level captions and text animations in the full editor.</p>
    {/if}
  </div>
  <a class="pane-link" href="/editor">Open the full editor <LandingIcon name="arrow" size={15} /></a>
</div>

<style>
  .editor-controls { display: flex; flex-direction: column; height: 100%; min-width: 0; }
  .pane-heading { display: flex; align-items: center; gap: 8px; min-height: 49px; padding: 12px 16px; border-bottom: 1px solid var(--home-rule); font-size: 12px; }
  .pane-heading a { margin-left: auto; color: var(--home-accent); display: flex; }
  .tool-tabs { display: flex; flex-wrap: wrap; gap: 0; border-bottom: 1px solid var(--home-rule); padding: 6px 9px; }
  .tool-tabs button { border: 0; background: none; color: var(--home-muted); padding: 7px; font-size: 10px; cursor: pointer; }
  .tool-tabs button.active { color: var(--home-accent); background: var(--home-tint); }
  .tool-body { padding: 14px 15px; flex: 1; }
  .tool-instruction { color: var(--home-muted); font-size: 11px; line-height: 1.5; margin: 0 0 13px; }
  .scene-item { display: flex; align-items: center; gap: 9px; width: 100%; text-align: left; border: 0; border-bottom: 1px solid var(--home-rule); padding: 10px 0; color: var(--home-ink); background: none; cursor: grab; font-size: 11px; }
  .scene-item:hover { color: var(--home-accent); }
  .scene-thumbnail { display: grid; place-items: center; width: 48px; height: 35px; flex-shrink: 0; }
  small { display: block; color: var(--home-muted); font-size: 9px; line-height: 1.5; margin-top: 3px; }
  .scene-add { display: flex; margin-left: auto; color: var(--home-accent); font-size: 19px; }
  .preset { display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%; padding: 12px 9px; border: 1px solid var(--home-rule); border-bottom: 0; text-align: left; background: none; color: var(--home-ink); cursor: pointer; font-size: 12px; }
  .preset:last-of-type { border-bottom: 1px solid var(--home-rule); }
  .preset:hover, .preset.active { color: var(--home-accent); background: var(--home-tint); }
  .preset:disabled { opacity: .45; cursor: not-allowed; }
  .reset-preset { display: block; border: 0; background: none; padding: 11px 0; color: var(--home-muted); text-decoration: underline; font-size: 10px; cursor: pointer; }
  .reset-preset:disabled { opacity: .45; cursor: not-allowed; }
  .pane-link { border-top: 1px solid var(--home-rule); padding: 14px 16px; color: var(--home-accent); display: flex; align-items: center; justify-content: space-between; font-size: 11px; text-decoration: none; }
  .add-title { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 10px; width: 100%; border: 1px solid var(--home-accent); color: var(--home-accent); background: none; cursor: pointer; font-size: 11px; }
  .title-field { display: grid; gap: 8px; margin-top: 18px; color: var(--home-muted); font-size: 11px; }
  .title-field input { width: 100%; min-width: 0; padding: 10px; border: 1px solid var(--home-rule); background: var(--home-bg); color: var(--home-ink); font: inherit; }
  .text-note { font-size: 11px; line-height: 1.6; color: var(--home-muted); margin-top: 20px; }
</style>
