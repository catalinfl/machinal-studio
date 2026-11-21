<script lang="ts">
  import Inspector from './Inspector.svelte'
  import UiSelect from './UiSelect.svelte'
  import type { TextAlign } from '../stores/editor.svelte'
  import { useTextInspector } from '../composables/useTextInspector.svelte'

  const inspector = useTextInspector()
</script>

{#if inspector.item}
  <Inspector
    id="text-inspector"
    ariaLabel="Text inspector"
    eyebrow="Inspector"
    title="Text"
    selectionLabel={inspector.selectedItems.length > 1 ? `${inspector.selectedItems.length} text layers selected` : 'Independent visual layer'}
    onClose={inspector.close}
  >

    <section>
      <h3>Content</h3>
      <textarea aria-label="Text content" value={inspector.item.text} onfocus={inspector.beginHistory} oninput={inspector.updateText} onblur={inspector.endHistory}></textarea>
      {#if inspector.selectedItems.length > 1}<small class="selection-hint">Content and timing edit the active layer. Style changes apply to all {inspector.selectedItems.length} selected layers.</small>{/if}
    </section>

    <section>
      <h3>Caption</h3>
      <label><span>Type</span><UiSelect label="Text type" value={inspector.item.isCaption ? 'caption' : 'text'} options={[{ value: 'text', label: 'Text' }, { value: 'caption', label: 'Caption' }]} onChange={(next) => inspector.setValue('isCaption', next)} /></label>
      {#if inspector.item.isCaption}
        <label><span>Active word</span><UiSelect label="Text active word highlight" value={inspector.item.highlightMode} options={[{ value: 'none', label: 'Off' }, { value: 'word', label: 'Highlight' }]} onChange={(next) => inspector.setValue('highlightMode', next)} /></label>
        {#if inspector.item.highlightMode === 'word'}
          <label><span>Word motion</span><UiSelect label="Text active word animation" value={inspector.item.highlightAnimation} options={inspector.WORD_ANIMATION_OPTIONS.map((option) => ({ value: option.id, label: option.label }))} onChange={(next) => inspector.setValue('highlightAnimation', next)} /></label>
          <label><span>Word color</span><input aria-label="Text active word color" type="color" value={inspector.item.highlightColor} oninput={inspector.updateValue('highlightColor')} /></label>
          <label><span>Word background</span><span class="paired"><input aria-label="Text active word background color" type="color" value={inspector.item.highlightBackgroundColor} oninput={inspector.updateValue('highlightBackgroundColor')} /><input aria-label="Text active word background opacity" type="number" min="0" max="1" step="0.05" value={inspector.item.highlightBackgroundOpacity} onchange={inspector.updateNumber('highlightBackgroundOpacity')} /></span></label>
        {/if}
      {/if}
    </section>

    <section>
      <div class="section-heading">
        <h3>Background</h3>
         <button class="switch" class:active={inspector.item.backgroundOpacity > 0} aria-pressed={inspector.item.backgroundOpacity > 0} onclick={inspector.toggleBackground}>{inspector.item.backgroundOpacity > 0 ? 'On' : 'Off'}</button>
      </div>
       <label><span>Color</span><input aria-label="Text background color" type="color" value={inspector.item.backgroundColor} oninput={inspector.updateValue('backgroundColor')} /></label>
       <label><span>Opacity</span><span class="range"><input aria-label="Text background opacity" type="range" min="0" max="1" step="0.01" value={inspector.item.backgroundOpacity} onfocus={inspector.beginHistory} oninput={inspector.updateNumber('backgroundOpacity')} onblur={inspector.endHistory} /><output>{(inspector.item.backgroundOpacity * 100).toFixed(2)}%</output></span></label>
      <div class="grid">
         <label><span>Padding</span><input aria-label="Text background padding" type="number" min="0" max="200" value={inspector.item.backgroundPadding} onchange={inspector.updateNumber('backgroundPadding')} /></label>
         <label><span>Corner</span><input aria-label="Text background radius" type="number" min="0" max="200" value={inspector.item.backgroundRadius} onchange={inspector.updateNumber('backgroundRadius')} /></label>
      </div>
    </section>

    <section>
      <h3>Banner</h3>
       <label><span>Style</span><UiSelect label="Text banner style" value={inspector.item.bannerStyle} options={[{ value: 'none', label: 'None' }, { value: 'rail', label: 'Color rail' }, { value: 'block', label: 'Color block' }, { value: 'underline', label: 'Underline' }]} onChange={(next) => inspector.setValue('bannerStyle', next)} /></label>
       {#if inspector.item.bannerStyle !== 'none'}
         <label><span>Accent</span><input aria-label="Text banner accent color" type="color" value={inspector.item.accentColor} oninput={inspector.updateValue('accentColor')} /></label>
      {/if}
    </section>

    <section>
      <h3>Typography</h3>
       <label><span>Font</span><UiSelect
          label="Text font"
          value={inspector.item.fontFamily}
          groups={inspector.TEXT_FONT_CATEGORIES.map((category) => ({
            label: category,
            options: inspector.TEXT_FONTS.filter((font) => font.category === category).map((font) => ({
              value: font.id,
              label: font.label,
              previewStyle: `font-family: ${font.css}`,
            })),
          }))}
          onChange={(next) => inspector.setValue('fontFamily', next)}
        /></label>
       <label><span>Size</span><input aria-label="Text size" type="number" min="8" max="600" value={inspector.item.fontSize} onchange={inspector.updateNumber('fontSize')} /></label>
      <div class="button-row">
         <button class:active={inspector.item.fontWeight === 700} aria-pressed={inspector.item.fontWeight === 700} onclick={inspector.toggleBold} aria-label="Bold text"><b>B</b></button>
         <button class:active={inspector.item.italic} aria-pressed={inspector.item.italic} onclick={inspector.toggleItalic} aria-label="Italic text"><i>I</i></button>
      </div>
       <label><span>Fill</span><input aria-label="Text color" type="color" value={inspector.item.color} oninput={inspector.updateValue('color')} /></label>
       <label><span>Outline</span><span class="paired"><input aria-label="Text outline color" type="color" value={inspector.item.strokeColor} oninput={inspector.updateValue('strokeColor')} /><input aria-label="Text outline width" type="number" min="0" max="40" value={inspector.item.strokeWidth} onchange={inspector.updateNumber('strokeWidth')} /></span></label>
    </section>

    <section>
      <div class="section-heading">
        <h3>Layout</h3>
         <small class="hint">{inspector.editor.effectiveProjectAspect === 'portrait' ? 'Social-safe position' : 'Frame-safe position'}</small>
      </div>
      <div class="pos-grid" role="group" aria-label="Position text on screen">
         {#each inspector.TEXT_POSITION_CELLS as cell (cell.id)}
          <button
             class:active={inspector.activeCell === cell.id}
             aria-pressed={inspector.activeCell === cell.id}
            class="cell col-{cell.col}"
             onclick={inspector.applyCellFor(cell)}
            aria-label="Position text {cell.label}"
            title="Position text {cell.label}"
          ><span class="ln"></span><span class="ln"></span><span class="ln"></span></button>
        {/each}
      </div>
      <div class="align">
        <span class="align-label">Align</span>
         {#each ['left', 'center', 'right', 'justify'] as align (align)}<button class:active={inspector.item.align === align} aria-pressed={inspector.item.align === align} onclick={inspector.updateAlign(align as TextAlign)} aria-label="Align text {align}">{align === 'left' ? 'L' : align === 'center' ? 'C' : align === 'right' ? 'R' : 'J'}</button>{/each}
      </div>
    </section>

    <section>
      <h3>Transform</h3>
      <div class="grid">
         <label><span>X</span><input aria-label="Text X position" type="number" min="0" max={inspector.design.w} value={inspector.item.x.toFixed(2)} onchange={inspector.updateNumber('x')} /></label>
         <label><span>Y</span><input aria-label="Text Y position" type="number" min="0" max={inspector.design.h} value={inspector.item.y.toFixed(2)} onchange={inspector.updateNumber('y')} /></label>
      </div>
       <label><span>Rotation</span><input aria-label="Text rotation" type="number" min="-180" max="180" value={inspector.item.rotation.toFixed(2)} onchange={inspector.updateNumber('rotation')} /></label>
       <label><span>Opacity</span><span class="range"><input aria-label="Text opacity" type="range" min="0" max="1" step="0.01" value={inspector.item.opacity} onfocus={inspector.beginHistory} oninput={inspector.updateNumber('opacity')} onblur={inspector.endHistory} /><output>{(inspector.item.opacity * 100).toFixed(2)}%</output></span></label>
    </section>

    <section>
      <h3>Timing</h3>
      <div class="grid">
         <label><span>Start</span><input aria-label="Text start" type="number" min="0" step="0.033" value={inspector.item.start.toFixed(2)} onchange={inspector.updateNumber('start')} /></label>
         <label><span>Duration</span><input aria-label="Text duration" type="number" min="0.2" step="0.1" value={inspector.item.duration.toFixed(2)} onchange={inspector.updateNumber('duration')} /></label>
      </div>
       <label><span>Motion</span><UiSelect label="Text animation" value={inspector.item.animation} options={inspector.TEXT_ANIMATION_OPTIONS.map((option) => ({ value: option.id, label: option.label }))} onChange={(next) => inspector.setValue('animation', next)} /></label>
       {#if inspector.textAnimationOption(inspector.item.animation).usesDuration}
         <label><span>Transition</span><span class="range"><input aria-label="Text animation duration" type="range" min="0.1" max="2" step="0.05" value={inspector.item.animationDuration} onfocus={inspector.beginHistory} oninput={inspector.updateNumber('animationDuration')} onblur={inspector.endHistory} /><output>{inspector.item.animationDuration.toFixed(2)}s</output></span></label>
      {/if}
    </section>
  </Inspector>
{/if}

<style>
  .section-heading { min-height:var(--height-control-sm); display:flex; align-items:flex-start; justify-content:space-between; gap:var(--space-4); }
  .section-heading h3 { margin-top:var(--space-3); }
  .switch { min-width:42px; height:var(--height-control-sm); padding:0 var(--space-5); border:1px solid var(--border); border-radius:var(--radius-pill); color:var(--secondary-foreground); background:var(--secondary); font-size:var(--text-2xs); cursor:pointer; }
  .switch:hover { border-color:var(--border-strong); background:var(--surface-muted); }
  .switch.active { border-color:var(--primary); color:var(--primary); background:var(--primary-subtle); }
  .switch:focus-visible { outline:2px solid var(--ring); outline-offset:2px; }
  label { min-height:38px; display:flex; align-items:center; justify-content:space-between; gap:var(--space-5); border-top:1px solid var(--border); color:var(--secondary-foreground); font-size:var(--text-2xs); }
  textarea { width:100%; min-height:72px; padding:var(--space-5); resize:vertical; line-height:var(--leading-copy); }
  .selection-hint { display:block; margin-top:var(--space-3); color:var(--muted-foreground); font-size:var(--text-2xs); line-height:var(--leading-ui); }
  input { width:132px; height:var(--height-control-sm); padding:0 var(--space-4); }
  label :global(.ui-select) { width:132px; }
  input[type=color] { width:54px; padding:var(--space-1); }
  .button-row { display:flex; gap:var(--space-2); padding:var(--space-5) 0; }
  .button-row button { width:31px; height:var(--height-control-sm); border:1px solid var(--border); border-radius:var(--radius-sm); color:var(--secondary-foreground); background:var(--secondary); cursor:pointer; }
  .button-row button:hover { border-color:var(--border-strong); background:var(--surface-muted); }
  .button-row button.active { border-color:var(--primary); color:var(--primary); background:var(--primary-subtle); }
  .button-row button:focus-visible { outline:2px solid var(--ring); outline-offset:2px; }
  .hint { margin-top:var(--space-3); color:var(--muted-foreground); font-size:var(--text-2xs); text-transform:none; letter-spacing:0; }
  .pos-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:var(--space-2); padding:var(--space-5) 0 var(--space-2); }
  .pos-grid .cell { height:30px; display:flex; flex-direction:column; justify-content:center; gap:var(--space-1); padding:0 var(--space-4); box-sizing:border-box; border:1px solid var(--border); border-radius:var(--radius-sm); background:var(--surface-elevated); cursor:pointer; }
  .pos-grid .cell.col-0 { align-items:flex-start; } .pos-grid .cell.col-1 { align-items:center; } .pos-grid .cell.col-2 { align-items:flex-end; }
  .pos-grid .cell:hover { border-color:var(--border-strong); background:var(--surface-muted); }
  .pos-grid .cell.active { border-color:var(--primary); background:var(--primary-subtle); box-shadow:inset 0 0 0 1px var(--primary); }
  .pos-grid .cell:focus-visible { outline:2px solid var(--ring); outline-offset:2px; }
  .pos-grid .ln { width:100%; height:2px; border-radius:var(--radius-xs); background:var(--border-strong); }
  .pos-grid .ln:nth-child(2) { width:68%; } .pos-grid .ln:nth-child(3) { width:82%; }
  .pos-grid .cell:hover .ln { background:var(--foreground); }
  .pos-grid .cell.active .ln { background:var(--primary); }
  .align { display:flex; align-items:center; gap:var(--space-2); padding:var(--space-4) 0 var(--space-1); border-top:1px solid var(--border); }
  .align-label { margin-right:auto; color:var(--muted-foreground); font-size:var(--text-2xs); letter-spacing:var(--tracking-label); text-transform:uppercase; }
  .align button { width:var(--height-control-sm); height:var(--height-control-sm); border:1px solid var(--border); border-radius:var(--radius-sm); color:var(--secondary-foreground); background:var(--secondary); cursor:pointer; font-size:var(--text-2xs); }
  .align button:hover { border-color:var(--border-strong); background:var(--surface-muted); }
  .align button.active { border-color:var(--primary); color:var(--primary); background:var(--primary-subtle); }
  .align button:focus-visible { outline:2px solid var(--ring); outline-offset:2px; }
  .paired, .range { display:flex; align-items:center; gap:var(--space-4); } .paired input[type=number] { width:70px; }
  .range input { width:94px; padding:0; accent-color:var(--primary); } output { flex:0 0 7ch; width:7ch; color:var(--foreground); font:var(--text-2xs) var(--font-mono); text-align:right; white-space:nowrap; }
  .grid { display:grid; grid-template-columns:1fr 1fr; gap:var(--space-4); }
  .grid label { flex-direction:column; align-items:stretch; gap:var(--space-3); padding:var(--space-4) 0; }
  .grid input { width:100%; }
</style>
