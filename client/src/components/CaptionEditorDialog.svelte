<script lang="ts">
  import { formatCaptionTime, type CaptionDraft } from '../lib/subtitles'
  import { useCaptionEditorDialog } from '../composables/useCaptionEditorDialog.svelte'
  import UiSelect from './UiSelect.svelte'
  import RecipeSnippet from './RecipeSnippet.svelte'
  import { captionJobSnippet } from '../lib/composition-recipes'

  interface Props {
    drafts: CaptionDraft[]
    maxItems: number
    mode?: 'create' | 'edit'
    kind?: 'caption' | 'text'
    onCancel: (drafts: CaptionDraft[]) => void
    onAdd: (drafts: CaptionDraft[]) => void
  }

  let { drafts, maxItems, mode = 'create', kind = 'caption', onCancel, onAdd }: Props = $props()
  const editor = useCaptionEditorDialog({
    getDrafts: () => drafts,
    getMaxItems: () => maxItems,
    getMode: () => mode,
    getKind: () => kind,
    getOnCancel: () => onCancel,
    getOnAdd: () => onAdd,
  })
  const styleDisabled = $derived(editor.includedDrafts.length === 0 || !editor.styleReference)
  const selectionStatus = $derived.by(() => {
    if (editor.includedDrafts.length === 0) return 'None selected'
    if (editor.includedDrafts.length === editor.workingDrafts.length) return 'All selected'
    return `${editor.includedDrafts.length} selected`
  })
</script>

<dialog
  class="caption-dialog"
  bind:this={editor.dialogEl}
  aria-labelledby="caption-editor-title"
  onclose={() => onCancel(editor.snapshotDrafts())}
  oncancel={(event) => event.preventDefault()}
>
  <div class="dialog-shell">
    <header class="dialog-head">
      <div class="dialog-title">
        <div class="title-line">
          <h2 id="caption-editor-title">{mode === 'edit' ? kind === 'text' ? 'Edit text' : 'Edit captions' : 'Review captions'}</h2>
          <span class="mode-chip">{mode === 'edit' ? 'Timeline' : 'Transcript'}</span>
        </div>
      </div>
      <div class="header-tools">
         <button class="icon-button" onclick={editor.closeDialog} aria-label="Close caption editor">
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" /></svg>
        </button>
      </div>
    </header>

    <div class="dialog-body">
      <section class="cue-pane" aria-label={kind === 'text' ? 'Text layers' : 'Caption lines'}>
        <div class="cue-toolbar">
          <div class="selection-summary">
            <div class="selection-summary-copy" aria-live="polite">
              <strong>{editor.workingDrafts.length} {kind === 'text' ? 'text layer' : 'caption'}{editor.workingDrafts.length === 1 ? '' : 's'}</strong>
              <span class="selection-status">{selectionStatus}</span>
            </div>
          </div>
          <div class="selection-actions">
             <button onclick={editor.selectAll}>Select all</button>
             <button onclick={editor.clearAll}>Clear</button>
          </div>
        </div>

        <div class="cue-list">
           {#each editor.workingDrafts as draft, index (draft.draftId)}
            <article class="cue-row" class:included={draft.included}>
              <label class="cue-select">
                 <input type="checkbox" bind:checked={draft.included} onchange={editor.clearPreset} aria-label="Include caption {index + 1}" />
                <span class="cue-index">{String(index + 1).padStart(2, '0')}</span>
              </label>
              <div class="cue-content">
                <div class="cue-header">
                  <div class="cue-meta">
                    <div class="cue-range" aria-label={`Start ${formatCaptionTime(draft.start)}, end ${formatCaptionTime(draft.start + draft.duration)}`}>
                      <span class="range-point"><small>Start</small><span>{formatCaptionTime(draft.start)}</span></span>
                      <span class="range-rule" aria-hidden="true"></span>
                      <span class="range-point"><small>End</small><span>{formatCaptionTime(draft.start + draft.duration)}</span></span>
                    </div>
                  </div>
                  <div class="cue-timing" aria-label={kind === 'text' ? 'Text timing' : 'Caption timing'}>
                    <div class="timing-group">
                      <span class="timing-label">Start</span>
                      <div class="timing-control"><input aria-label="Caption {index + 1} start" type="number" min="0" step="0.01" value={draft.start.toFixed(2)} onchange={editor.updateDraftStartFor(draft)} /><span aria-hidden="true">s</span></div>
                    </div>
                    <div class="timing-group">
                      <span class="timing-label">End</span>
                       <div class="timing-control"><input aria-label="Caption {index + 1} end" type="number" min="0.2" step="0.01" value={(draft.start + draft.duration).toFixed(2)} onchange={editor.updateDraftEndFor(draft)} /><span aria-hidden="true">s</span></div>
                    </div>
                  </div>
                </div>
                <textarea
                  aria-label={kind === 'text' ? `Text ${index + 1} content` : `Caption ${index + 1} text`}
                  value={draft.text}
                   oninput={editor.updateDraftTextFor(draft)}
                ></textarea>
              </div>
            </article>
          {/each}
        </div>
      </section>

      <aside class="style-pane" aria-label={kind === 'text' ? 'Selected text settings' : 'Selected caption settings'}>
        <div class="style-heading">
          <h3>{kind === 'text' ? 'Text settings' : 'Caption settings'}</h3>
        </div>

        {#if kind === 'caption'}
          <div class="caption-top">
            <label class="caption-length">
              <strong>Words per caption</strong>
              <input aria-label="Words per caption" type="number" min="1" max="12" step="1" value={editor.wordsPerCaption} onchange={editor.updateWordsPerCaption} />
            </label>
          </div>
        {/if}

         <fieldset disabled={editor.includedDrafts.length === 0 || !editor.styleReference}>
          <div class="style-section essentials-section">
            <div class="section-heading">
              <span>Short-form essentials</span>
              <small>Choose a look, then adjust word motion</small>
            </div>
            <label class="preset-picker">
              <span>Style preset</span>
               <UiSelect
                 label="Short-form caption preset"
                 value={editor.selectedPresetId ?? ''}
                 groups={editor.shortFormPresetGroups}
                 placeholder="Choose a style"
                 disabled={styleDisabled}
                 onChange={editor.selectPresetById}
               />
            </label>
             {#if editor.styleReference}
                <div class="selected-preview" aria-live="polite">
                  <div class="preview-heading">
                    <span>Preview</span>
                    <small>{editor.previewHeadingLabel}</small>
                    <span class="preview-controls">
                      <button class="preview-toggle" onclick={editor.replayPreview} aria-label="Replay caption preview" title="Replay preview">
                        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 1.8v3h-3" /></svg>
                      </button>
                      <button class="preview-toggle" onclick={editor.togglePreviewPlaying} aria-label={editor.previewPlaying ? 'Pause caption preview' : 'Play caption preview'} aria-pressed={editor.previewPlaying} title={editor.previewPlaying ? 'Pause preview' : 'Play preview'}>
                        {#if editor.previewPlaying}
                          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5.5 3.5v9M10.5 3.5v9" /></svg>
                        {:else}
                          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.8v8.4L12 8Z" /></svg>
                        {/if}
                      </button>
                    </span>
                  </div>
                  <div class="preset-preview position-{editor.livePreviewPosition}" role="img" aria-label={kind === 'text' ? 'Selected text style preview' : 'Selected caption style preview'}>
                    {#key editor.previewCycle}
                      <span
                        class="preview-caption {editor.livePreviewAnimation !== 'none' ? `enter-${editor.livePreviewAnimation}` : ''}"
                        style={`${editor.livePreviewTextStyle};--preview-motion-duration:${editor.livePreviewMotionDuration.toFixed(2)}s`}
                        aria-hidden="true"
                       >{#each editor.previewWords as word, index (index)}{#if editor.livePreviewHighlightOn && index === editor.previewActiveWordIndex}{#key editor.previewActiveWordIndex}<span class="preview-word preview-word-active {editor.livePreviewWordMotionClass}" style={editor.livePreviewSubtitleStyle}>{word}</span>{/key}{:else}<span class="preview-word">{word}</span>{/if}{#if index < editor.previewWords.length - 1}{' '}{/if}{/each}</span>
                    {/key}
                  </div>
                </div>
            {:else}
              <div class="preview-empty">Select a style to see how it looks.</div>
            {/if}
            {#if kind === 'caption' || editor.commonValue('isCaption') === true}
              <div class="preset-motion">
                <label><span>Active word</span><UiSelect label="Active word highlight" value={String(editor.commonValue('highlightMode'))} options={[{ value: 'word', label: 'Highlight' }, { value: 'none', label: 'Off' }]} placeholder="Mixed" disabled={styleDisabled} onChange={(next) => editor.setStyleValue('highlightMode', next)} /></label>
                {#if editor.commonValue('highlightMode') === 'word'}
                  <label><span>Word motion</span><UiSelect label="Active word animation" value={String(editor.commonValue('highlightAnimation'))} options={editor.wordAnimationOptions.map((option) => ({ value: option.id, label: option.label }))} placeholder="Mixed" disabled={styleDisabled} onChange={(next) => editor.setStyleValue('highlightAnimation', next)} /></label>
                {/if}
              </div>
            {/if}
          </div>
          {#if editor.canRegroup}
            <div class="size-after-style">
              <label>
                <strong>Size</strong>
                <span class="size-control"><input aria-label={kind === 'text' ? 'Text size' : 'Caption size'} type="number" min="8" max="600" value={editor.commonValue('fontSize')} onchange={editor.styleNumber('fontSize')} disabled={styleDisabled} /><span class="unit" aria-hidden="true">px</span></span>
              </label>
            </div>
          {/if}
          <div class="style-section">
            <div class="section-heading"><span>Text treatment</span></div>
             <label><span>Type</span><UiSelect label={kind === 'text' ? 'Text type' : 'Caption type'} value={editor.commonValue('isCaption') === '' ? '' : editor.commonValue('isCaption') ? 'caption' : 'text'} options={[{ value: 'caption', label: 'Caption' }, { value: 'text', label: 'Text' }]} placeholder="Mixed" disabled={styleDisabled} onChange={(next) => editor.setStyleValue('isCaption', next)} /></label>
             <label><span>Motion</span><UiSelect label={kind === 'text' ? 'Text animation' : 'Caption animation'} value={String(editor.commonValue('animation'))} options={editor.textAnimationOptions.map((option) => ({ value: option.id, label: option.label }))} placeholder="Mixed" disabled={styleDisabled} onChange={(next) => editor.setStyleValue('animation', next)} /></label>
             {#if editor.selectedAnimation.usesDuration}
               <label><span>Transition</span><span class="paired"><input aria-label={kind === 'text' ? 'Text animation duration' : 'Caption animation duration'} type="number" min="0.1" max="2" step="0.05" value={editor.commonValue('animationDuration')} onchange={editor.styleNumber('animationDuration')} /><span class="unit">s</span></span></label>
            {/if}
             <label><span>Font</span><UiSelect
               label={kind === 'text' ? 'Text font' : 'Caption font'}
               value={String(editor.commonValue('fontFamily'))}
               groups={editor.textFontCategories.map((category) => ({
                 label: category,
                 options: editor.textFonts.filter((font) => font.category === category).map((font) => ({ value: font.id, label: font.label })),
               }))}
               placeholder="Mixed"
               disabled={styleDisabled}
               onChange={(next) => editor.setStyleValue('fontFamily', next)}
             /></label>
            <div class="font-preview" aria-label={kind === 'text' ? 'Selected text font preview' : 'Selected font preview'} aria-live="polite">
               <span>{editor.selectedFont?.label ?? 'Mixed fonts'}</span>
              <strong
                 style:font-family={editor.selectedFont?.css}
                 style:font-weight={editor.commonValue('fontWeight') === 700 ? 700 : 400}
                 style:font-style={editor.commonValue('italic') === true ? 'italic' : 'normal'}
               >{editor.fontPreviewText}</strong>
            </div>
            {#if !editor.canRegroup}
              <label><span>Size</span><input aria-label={kind === 'text' ? 'Text size' : 'Caption size'} type="number" min="8" max="600" value={editor.commonValue('fontSize')} onchange={editor.styleNumber('fontSize')} /></label>
            {/if}
            <div class="style-toggle-row" aria-label="Text emphasis">
               <button class:active={editor.commonValue('fontWeight') === 700} aria-pressed={editor.commonValue('fontWeight') === 700} onclick={editor.toggleFontWeight} aria-label={kind === 'text' ? 'Bold selected text' : 'Bold selected captions'}><b>B</b><span>Bold</span></button>
               <button class:active={editor.commonValue('italic') === true} aria-pressed={editor.commonValue('italic') === true} onclick={editor.toggleItalic} aria-label={kind === 'text' ? 'Italic selected text' : 'Italic selected captions'}><i>I</i><span>Italic</span></button>
            </div>
          </div>
          <details class="advanced-settings"><summary>Advanced appearance &amp; position</summary>
          <div class="style-section">
            <div class="section-heading"><span>Color and edge</span></div>
             <label><span>Text color</span><input aria-label={kind === 'text' ? 'Text color' : 'Caption text color'} type="color" value={editor.styleReference?.color ?? '#ffffff'} oninput={editor.styleValue('color')} /></label>
             {#if kind === 'caption' || editor.commonValue('isCaption') === true}
               <label><span>Word color</span><input aria-label="Active word color" type="color" value={editor.styleReference?.highlightColor ?? '#fff36d'} oninput={editor.styleValue('highlightColor')} /></label>
               <label><span>Word background</span><span class="paired"><input aria-label="Active word background color" type="color" value={editor.styleReference?.highlightBackgroundColor ?? '#000000'} oninput={editor.styleValue('highlightBackgroundColor')} /><input aria-label="Active word background opacity" type="number" min="0" max="1" step="0.05" value={editor.commonValue('highlightBackgroundOpacity')} onchange={editor.styleNumber('highlightBackgroundOpacity')} /></span></label>
            {/if}
             <label><span>Background</span><span class="paired"><input aria-label={kind === 'text' ? 'Text background color' : 'Caption background color'} type="color" value={editor.styleReference?.backgroundColor ?? '#000000'} oninput={editor.styleValue('backgroundColor')} /><input aria-label={kind === 'text' ? 'Text background opacity' : 'Caption background opacity'} type="number" min="0" max="1" step="0.05" value={editor.commonValue('backgroundOpacity')} onchange={editor.styleNumber('backgroundOpacity')} /></span></label>
             <label><span>Outline</span><span class="paired"><input aria-label={kind === 'text' ? 'Text outline color' : 'Caption outline color'} type="color" value={editor.styleReference?.strokeColor ?? '#000000'} oninput={editor.styleValue('strokeColor')} /><input aria-label={kind === 'text' ? 'Text outline width' : 'Caption outline width'} type="number" min="0" max="40" value={editor.commonValue('strokeWidth')} onchange={editor.styleNumber('strokeWidth')} /></span></label>
          </div>
          <div class="style-section">
            <div class="section-heading"><span>Position</span></div>
             <label><span>Align</span><UiSelect label={kind === 'text' ? 'Text alignment' : 'Caption alignment'} value={String(editor.commonValue('align'))} options={[{ value: 'left', label: 'Left' }, { value: 'center', label: 'Center' }, { value: 'right', label: 'Right' }, { value: 'justify', label: 'Justify' }]} placeholder="Mixed" disabled={styleDisabled} onChange={(next) => editor.setStyleValue('align', next)} /></label>
             <label><span>Vertical position</span><input aria-label={kind === 'text' ? 'Text vertical position' : 'Caption vertical position'} type="number" min="0" max="1920" value={editor.commonValue('y')} onchange={editor.styleNumber('y')} /></label>
          </div>
          </details>
          </fieldset>
         {#if kind === 'caption'}
            <details class="advanced-settings"><summary>Advanced · reusable recipe</summary><div class="recipe-export">
             <label class="recipe-language">Transcription language
               <select aria-label="Caption recipe language" bind:value={editor.captionLanguage}>
                 <option value="auto">Auto-detect</option>
                 <option value="ro">Romanian</option>
                 <option value="en">English</option>
               </select>
             </label>
             <RecipeSnippet title="Reuse caption settings" description="Copies an after job with your word count and selected look; speech is transcribed from the timeline at compile time." yaml={captionJobSnippet(editor.wordsPerCaption, editor.styleReference ?? undefined, editor.captionLanguage)} />
            </div></details>
         {/if}
       </aside>
    </div>

    <footer class="dialog-foot">
      <div>
         <button class="secondary" onclick={editor.closeDialog}>Cancel</button>
         <button class="primary" onclick={editor.addSelected} disabled={editor.includedDrafts.length === 0 || editor.exceedsLimit}>{mode === 'edit' ? kind === 'text' ? 'Save text changes' : 'Save caption changes' : 'Add selected captions'}</button>
      </div>
    </footer>
  </div>
</dialog>

<style>
  .caption-dialog {
    width:min(1220px, calc(100vw - var(--space-16)));
    height:min(820px, calc(100dvh - var(--space-16)));
    margin:auto;
    padding:0;
    overflow:hidden;
    border:1px solid var(--border-strong);
    border-radius:var(--radius-lg);
    color:var(--foreground);
    background-color:var(--surface-elevated);
    box-shadow:var(--shadow-dialog);
    font-family:var(--font-sans);
    transform-origin:center;
    will-change:transform, opacity;
    animation:dialog-arrive 200ms cubic-bezier(.16, 1, .3, 1) both;
  }

  .caption-dialog::backdrop { background:var(--scrim); animation:scrim-fade 200ms ease-out both; }

  .dialog-shell {
    height:100%;
    display:grid;
    grid-template-rows:auto minmax(0, 1fr) auto;
    isolation:isolate;
  }

  .dialog-head {
    min-height:68px;
    display:flex;
    align-items:center;
    justify-content:space-between;
    gap:var(--space-8);
    padding:var(--space-8) var(--space-10);
    border-bottom:1px solid var(--border);
    background:var(--surface-elevated);
  }

  .dialog-title { min-width:0; }
  .title-line { display:flex; flex-wrap:wrap; align-items:center; gap:var(--space-4); }
  .dialog-head h2 { margin:0; font-size:var(--text-xl); font-weight:var(--weight-bold); letter-spacing:-.025em; line-height:var(--leading-tight); }
  .mode-chip { padding:3px var(--space-3); border:1px solid var(--primary-border); border-radius:var(--radius-pill); color:var(--primary); background:var(--primary-subtle); font-size:var(--text-2xs); font-weight:var(--weight-semibold); line-height:1; }
  .header-tools { display:flex; align-items:center; flex:0 0 auto; }

  .icon-button {
    width:36px;
    height:36px;
    display:grid;
    place-items:center;
    flex:0 0 auto;
    border:1px solid var(--border);
    border-radius:var(--radius-sm);
    color:var(--secondary-foreground);
    background:var(--secondary);
    cursor:pointer;
    transition:border-color 140ms ease, background-color 140ms ease, color 140ms ease;
  }

  .icon-button:hover { border-color:var(--primary-border); color:var(--primary); background:var(--primary-subtle); }
  .icon-button svg { width:15px; height:15px; fill:none; stroke:currentColor; stroke-width:1.7; stroke-linecap:round; }

  .dialog-body { min-height:0; display:grid; grid-template-columns:minmax(0, 1fr) clamp(350px, 31vw, 380px); }

  .cue-pane {
    min-width:0;
    min-height:0;
    display:grid;
    grid-template-rows:auto minmax(0, 1fr);
    border-right:1px solid var(--border);
    background:var(--surface-elevated);
  }

  .cue-toolbar {
    min-height:56px;
    display:flex;
    align-items:center;
    justify-content:space-between;
    gap:var(--space-8);
    padding:var(--space-5) var(--space-8);
    border-bottom:1px solid var(--border);
    background:var(--surface);
  }

  .selection-summary { min-width:0; }
  .selection-summary-copy { display:flex; flex-direction:column; align-items:flex-start; gap:2px; }
  .cue-toolbar strong { color:var(--foreground); font-size:var(--text-sm); font-weight:var(--weight-semibold); line-height:var(--leading-ui); }
  .selection-status { color:var(--secondary-foreground); font-size:var(--text-xs); line-height:var(--leading-ui); }
  .selection-actions { display:flex; gap:var(--space-2); }

  .selection-actions button {
    height:32px;
    padding:0 var(--space-4);
    border:1px solid var(--border);
    border-radius:var(--radius-sm);
    color:var(--secondary-foreground);
    background:var(--surface-elevated);
    font-size:var(--text-xs);
    font-weight:var(--weight-semibold);
    line-height:1;
    cursor:pointer;
    transition:border-color 140ms ease, background-color 140ms ease;
  }

  .selection-actions button:hover { border-color:var(--primary-border); background:var(--primary-subtle); }
  .selection-actions button:active, .style-toggle-row button:active, .dialog-foot button:active { transform:translateY(1px); }
  .cue-list { min-height:0; overflow-x:hidden; overflow-y:auto; overscroll-behavior:contain; scrollbar-color:var(--border-strong) var(--surface); scrollbar-gutter:stable; }

  .cue-row {
    display:grid;
    grid-template-columns:48px minmax(0, 1fr);
    border-bottom:1px solid var(--border);
    background:var(--surface-elevated);
    transition:background-color 120ms ease;
    /* Sare peste layout/paint pentru randurile din afara viewportului:
       la deschidere cu zeci de cues, prima pictare nu mai blocheaza
       animatia dialogului. */
    content-visibility:auto;
    contain-intrinsic-size:auto 110px;
  }

  .cue-row:hover, .cue-row:focus-within { background:var(--surface); }
  .cue-row.included { background:color-mix(in srgb, var(--primary-subtle) 22%, var(--surface-elevated)); }
  .cue-row.included .cue-select { background:color-mix(in srgb, var(--primary-subtle) 38%, var(--surface-elevated)); }

  .cue-select {
    display:flex;
    flex-direction:column;
    align-items:center;
    gap:var(--space-3);
    padding:var(--space-6) var(--space-3);
    border-right:1px solid var(--border);
    cursor:pointer;
    transition:background-color 120ms ease;
  }

  .cue-select input { appearance:none; width:18px; height:18px; margin:0; border:1px solid var(--border-strong); border-radius:var(--radius-xs); background:var(--input); cursor:pointer; transition:border-color 120ms ease, background-color 120ms ease, box-shadow 120ms ease; }
  .cue-select input:hover { border-color:var(--primary); }
  .cue-select input:checked { border-color:var(--primary); background-color:var(--primary); background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='m2 6 2.5 2.5L10 3' fill='none' stroke='%23fff' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.8'/%3E%3C/svg%3E"); background-position:center; background-repeat:no-repeat; background-size:11px; }
  .cue-index { color:var(--muted-foreground); font:var(--text-2xs)/1 var(--font-mono); font-variant-numeric:tabular-nums; }
  .cue-row.included .cue-index { color:var(--primary); }

  .cue-content { min-width:0; display:flex; flex-direction:column; gap:var(--space-4); padding:var(--space-6) var(--space-8); }
  .cue-header { min-width:0; display:flex; align-items:center; justify-content:space-between; gap:var(--space-8); }
  .cue-meta { min-width:0; display:flex; align-items:center; }
  .cue-range { display:flex; align-items:flex-end; gap:var(--space-3); white-space:nowrap; }
  .range-point { display:flex; flex-direction:column; gap:3px; color:var(--foreground); font:var(--text-xs)/var(--leading-ui) var(--font-mono); font-variant-numeric:tabular-nums; }
  .range-point small { color:var(--secondary-foreground); font:var(--text-2xs)/1 var(--font-sans); }
  .range-rule { width:20px; height:1px; margin-bottom:8px; background:var(--border-strong); }

  .cue-content textarea {
    width:100%;
    min-height:54px;
    box-sizing:border-box;
    resize:vertical;
    padding:var(--space-5);
    border:1px solid var(--border);
    border-radius:var(--radius-md);
    outline:0;
    color:var(--foreground);
    background:var(--input);
    font:var(--text-sm)/var(--leading-ui) var(--font-sans);
    transition:border-color 140ms ease, box-shadow 140ms ease, background-color 140ms ease;
  }

  .cue-content textarea:hover { border-color:var(--border-strong); }
  .cue-content textarea:focus { border-color:var(--ring); box-shadow:0 0 0 3px color-mix(in srgb, var(--ring) 18%, transparent); background:var(--surface-elevated); }
  .cue-timing { display:flex; align-items:center; gap:var(--space-5); flex:0 0 auto; }
  .timing-group { display:flex; align-items:center; gap:var(--space-2); }
  .timing-label { color:var(--muted-foreground); font-size:var(--text-2xs); }
  .timing-control { position:relative; display:flex; align-items:center; }
  .cue-timing input { width:76px; height:28px; padding:0 var(--space-6) 0 var(--space-3); border:1px solid var(--border); border-radius:var(--radius-sm); outline:0; color:var(--foreground); background:var(--input); font-family:var(--font-mono); font-size:var(--text-2xs); font-variant-numeric:tabular-nums; }
  .cue-timing input:focus { border-color:var(--ring); box-shadow:0 0 0 2px color-mix(in srgb, var(--ring) 20%, transparent); }
  .timing-control > span { position:absolute; right:var(--space-3); color:var(--muted-foreground); font:var(--text-2xs)/1 var(--font-mono); pointer-events:none; }

  .style-pane { min-width:0; min-height:0; overflow-x:hidden; overflow-y:auto; overscroll-behavior:contain; scrollbar-gutter:stable; background:var(--surface); }
  .recipe-export { display:flex; flex-direction:column; gap:var(--space-6); padding:var(--space-8); }
  .recipe-language { display:flex; align-items:center; justify-content:space-between; gap:var(--space-4); color:var(--secondary-foreground); font-size:var(--text-xs); }
  .recipe-language select { min-height:32px; padding:0 var(--space-4); border:1px solid var(--border); border-radius:var(--radius-sm); background:var(--input); color:var(--foreground); font:inherit; }
  .recipe-language select:focus-visible { outline:2px solid var(--ring); outline-offset:2px; }

  .style-heading {
    position:sticky;
    top:0;
    z-index:2;
    min-height:56px;
    display:flex;
    align-items:center;
    padding:0 var(--space-8);
    border-bottom:1px solid var(--border);
    background:var(--surface-elevated);
  }

  .style-heading h3 { min-width:0; margin:0; color:var(--foreground); font-size:var(--text-md); font-weight:var(--weight-semibold); line-height:var(--leading-tight); }
  .caption-top { display:flex; align-items:stretch; border-bottom:1px solid var(--border); background:color-mix(in srgb, var(--surface-elevated) 50%, var(--surface)); }
  .caption-length { min-height:56px; flex:1; display:flex; align-items:center; justify-content:space-between; gap:var(--space-4); padding:var(--space-4) var(--space-8); color:var(--secondary-foreground); }
  .caption-length strong { font-size:var(--text-xs); font-weight:var(--weight-semibold); line-height:var(--leading-ui); }
  .caption-length input { width:60px; height:32px; flex:0 0 auto; padding:0 var(--space-3); font-family:var(--font-mono); font-variant-numeric:tabular-nums; text-align:center; }
  .size-control { display:flex; align-items:center; gap:var(--space-2); }
  .size-control .unit { color:var(--muted-foreground); font-family:var(--font-mono); font-size:var(--text-2xs); }
  .size-after-style { margin:0 calc(var(--space-8) * -1); padding:var(--space-3) var(--space-8); border-top:1px solid var(--border); border-bottom:1px solid var(--border); background:color-mix(in srgb, var(--surface-elevated) 50%, var(--surface)); }
  .size-after-style label { min-height:48px; display:flex; align-items:center; justify-content:space-between; gap:var(--space-4); color:var(--secondary-foreground); }
  .size-after-style strong { font-size:var(--text-sm); font-weight:var(--weight-semibold); line-height:var(--leading-ui); }
  .size-after-style input { width:72px; height:36px; flex:0 0 auto; padding:0 var(--space-3); font-size:var(--text-sm); font-family:var(--font-mono); font-variant-numeric:tabular-nums; text-align:center; }
  fieldset { min-width:0; margin:0; padding:0 var(--space-8); border:0; }
  fieldset:disabled { opacity:.5; }

  .style-section { min-width:0; padding:var(--space-8) 0; border-bottom:1px solid var(--border); }
  .style-section:last-child { border-bottom:0; }
  .section-heading { min-width:0; display:flex; flex-direction:column; align-items:flex-start; gap:var(--space-2); margin-bottom:var(--space-4); }
  .section-heading > span { min-width:0; color:var(--foreground); font-size:var(--text-2xs); font-weight:var(--weight-semibold); letter-spacing:var(--tracking-label); line-height:var(--leading-ui); text-transform:uppercase; }
  .section-heading > small { max-width:none; color:var(--muted-foreground); font-size:var(--text-2xs); line-height:var(--leading-ui); text-align:left; }
  .style-section > .preset-picker { min-height:0; display:flex; flex-direction:column; align-items:stretch; justify-content:flex-start; gap:var(--space-2); padding:0; border-bottom:0; color:var(--muted-foreground); font-size:var(--text-2xs); }

  .preset-picker :global(.ui-select-trigger) {
    height:38px;
    border-color:var(--primary-border);
    background:var(--surface-elevated);
    font-size:var(--text-xs);
    font-weight:var(--weight-semibold);
  }

   .preset-picker :global(.ui-select-trigger:hover:not(:disabled)) { border-color:var(--border-strong); }
  .selected-preview { display:flex; flex-direction:column; gap:var(--space-2); margin-top:var(--space-5); }
  .preview-heading { display:flex; align-items:center; gap:var(--space-3); color:var(--muted-foreground); font-size:var(--text-2xs); }
  .preview-heading span { color:var(--foreground); font-weight:var(--weight-semibold); }
  .preview-heading small { min-width:0; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .preview-controls { display:flex; gap:4px; flex:0 0 auto; }
  .preview-toggle { width:26px; height:26px; display:grid; place-items:center; border:1px solid var(--border); border-radius:var(--radius-sm); color:var(--secondary-foreground); background:var(--surface-elevated); cursor:pointer; transition:border-color 120ms ease, background-color 120ms ease, color 120ms ease; }
  .preview-toggle:hover { border-color:var(--primary-border); color:var(--primary); background:var(--primary-subtle); }
  .preview-toggle:focus-visible { outline:2px solid var(--ring); outline-offset:2px; }
  .preview-toggle svg { width:12px; height:12px; fill:none; stroke:currentColor; stroke-width:1.8; stroke-linecap:round; stroke-linejoin:round; }
  .preview-toggle[aria-pressed="true"] { border-color:var(--primary); color:var(--primary); background:var(--primary-subtle); }
  .preview-empty { margin-top:var(--space-5); padding:var(--space-8) var(--space-5); border:1px dashed var(--border-strong); border-radius:var(--radius-sm); color:var(--muted-foreground); font-size:var(--text-2xs); text-align:center; }
  .preset-motion { margin-top:var(--space-5); padding-top:var(--space-3); border-top:1px solid var(--border); }
  .preset-motion label { min-height:42px; display:flex; align-items:center; justify-content:space-between; gap:var(--space-4); border-bottom:1px solid color-mix(in srgb, var(--border) 68%, transparent); color:var(--secondary-foreground); font-size:var(--text-xs); }
  .preset-motion label:last-child { border-bottom:0; }
  .preset-motion :global(.ui-select) { width:min(156px, 54%); flex:0 1 auto; }
  .preset-preview { position:relative; display:flex; align-items:center; justify-content:center; min-width:0; aspect-ratio:16 / 8; overflow:hidden; border:1px solid var(--border); border-radius:var(--radius-sm); background:#26232c; color:#fff; }
  .preview-caption { display:block; max-width:88%; overflow:hidden; font-size:clamp(8px, 1.4vw, 13px); line-height:1.15; text-align:center; white-space:normal; overflow-wrap:break-word; }
  .preview-word { display:inline-block; padding:0 .1em; border-radius:3px; }
  .preview-word-active { will-change:transform; }
  .preview-word-active.motion-pop { animation:preview-word-pop 220ms both; }
  .preview-word-active.motion-bounce { animation:preview-word-bounce 320ms ease-out both; }
  .preview-word-active.motion-slide-up { animation:preview-word-rise 280ms cubic-bezier(.16, 1, .3, 1) both; }
  @keyframes preview-word-pop { 0% { transform:scale(1); animation-timing-function:cubic-bezier(.25, .75, .5, 1); } 40% { transform:scale(1.06); animation-timing-function:ease-in-out; } 100% { transform:scale(1); } }
  @keyframes preview-word-bounce { 0% { transform:scale(1.04); } 50% { transform:scale(.985); } 100% { transform:scale(1); } }
  @keyframes preview-word-rise { from { transform:translateY(4px); } to { transform:translateY(0); } }
  .preview-caption.enter-pop { animation:preview-enter-pop var(--preview-motion-duration, .45s) cubic-bezier(.16, 1, .3, 1) both; }
  .preview-caption.enter-rise { animation:preview-enter-rise var(--preview-motion-duration, .45s) cubic-bezier(.16, 1, .3, 1) both; }
  .preview-caption.enter-drop { animation:preview-enter-drop var(--preview-motion-duration, .45s) cubic-bezier(.16, 1, .3, 1) both; }
  .preview-caption.enter-bounce { animation:preview-enter-bounce var(--preview-motion-duration, .45s) ease-out both; }
  .preview-caption.enter-slide-left { animation:preview-enter-slide-left var(--preview-motion-duration, .45s) cubic-bezier(.16, 1, .3, 1) both; }
  .preview-caption.enter-slide-right { animation:preview-enter-slide-right var(--preview-motion-duration, .45s) cubic-bezier(.16, 1, .3, 1) both; }
  .preview-caption.enter-shake { animation:preview-enter-shake var(--preview-motion-duration, .45s) ease-out both; }
  .preview-caption.enter-float { animation:preview-enter-float var(--preview-motion-duration, .45s) ease-in-out both; }
  @keyframes preview-enter-pop { from { transform:translateY(14px); } to { transform:translateY(0); } }
  @keyframes preview-enter-rise { from { transform:translateY(18px); } to { transform:translateY(0); } }
  @keyframes preview-enter-drop { from { transform:translateY(-18px); } to { transform:translateY(0); } }
  @keyframes preview-enter-bounce { 0% { transform:translateY(15px); } 58% { transform:translateY(-3px); } 78% { transform:translateY(1px); } 100% { transform:translateY(0); } }
  @keyframes preview-enter-slide-left { from { transform:translateX(-115%); } to { transform:translateX(0); } }
  @keyframes preview-enter-slide-right { from { transform:translateX(115%); } to { transform:translateX(0); } }
  @keyframes preview-enter-shake { 0%, 100% { transform:translateX(0); } 18% { transform:translateX(-6px); } 38% { transform:translateX(5px); } 58% { transform:translateX(-3px); } 78% { transform:translateX(2px); } }
  @keyframes preview-enter-float { from { transform:translateY(4px); } to { transform:translateY(-4px); } }
  .position-top { align-items:flex-start; }
  .position-top .preview-caption { margin-top:var(--space-6); }
  .position-middle .preview-caption { transform:translateY(-1px); }
  .position-bottom { align-items:flex-end; }
  .position-bottom .preview-caption { margin-bottom:var(--space-5); }

  .style-section > label { min-width:0; min-height:42px; display:flex; align-items:center; justify-content:space-between; gap:var(--space-4); border-bottom:1px solid color-mix(in srgb, var(--border) 68%, transparent); color:var(--secondary-foreground); font-size:var(--text-xs); line-height:var(--leading-ui); }
  .style-section > label > span:first-child { min-width:0; }
  .style-section > label:last-child { border-bottom:0; }
   fieldset input { width:min(156px, 54%); height:32px; flex:0 1 auto; padding:0 var(--space-3); border:1px solid var(--border); border-radius:var(--radius-sm); outline:0; color:var(--foreground); background-color:var(--input); font-size:var(--text-xs); }
  fieldset :global(.ui-select) { width:min(156px, 54%); flex:0 1 auto; }
  fieldset input[type=number] { font-family:var(--font-mono); font-variant-numeric:tabular-nums; }
  fieldset input:hover { border-color:var(--border-strong); }
  fieldset input:focus { border-color:var(--ring); box-shadow:0 0 0 2px color-mix(in srgb, var(--ring) 20%, transparent); }
  fieldset input[type=color] { width:48px; padding:3px; border-radius:var(--radius-sm); cursor:pointer; }
  .font-preview { min-width:0; min-height:76px; display:flex; flex-direction:column; justify-content:center; gap:var(--space-3); margin:var(--space-4) 0; padding:var(--space-5); border:1px solid var(--border); border-radius:var(--radius-md); background:var(--surface-elevated); overflow:hidden; }
  .font-preview > span { color:var(--muted-foreground); font-size:var(--text-2xs); }
  .font-preview > strong { display:block; overflow:hidden; color:var(--foreground); font-size:var(--text-xl); line-height:var(--leading-tight); white-space:nowrap; text-overflow:ellipsis; }
  .paired { min-width:0; display:flex; align-items:center; gap:var(--space-2); }
  .paired input[type=number] { width:82px; }
  .paired .unit { color:var(--muted-foreground); font-family:var(--font-mono); font-size:var(--text-2xs); }
  .style-toggle-row { display:flex; gap:var(--space-2); padding-top:var(--space-4); }
  .style-toggle-row button { min-width:72px; height:32px; display:inline-flex; align-items:center; justify-content:center; gap:var(--space-2); border:1px solid var(--border); border-radius:var(--radius-sm); color:var(--secondary-foreground); background:var(--secondary); font-size:var(--text-xs); font-weight:var(--weight-medium); line-height:1; cursor:pointer; transition:border-color 120ms ease, background-color 120ms ease, color 120ms ease; }
  .style-toggle-row button span { font-size:var(--text-xs); }
  .style-toggle-row button:hover { border-color:var(--border-strong); background:var(--surface-muted); }
  .style-toggle-row button.active { border-color:var(--primary); color:var(--primary); background:var(--primary-subtle); }

  .dialog-foot { min-height:64px; display:flex; align-items:center; justify-content:flex-end; padding:var(--space-5) var(--space-8); padding-bottom:max(var(--space-5), env(safe-area-inset-bottom)); border-top:1px solid var(--border); background:var(--surface-elevated); }
  .dialog-foot > div { display:flex; gap:var(--space-3); }
  .dialog-foot button { height:34px; padding:0 var(--space-6); border-radius:var(--radius-sm); font-size:var(--text-xs); font-weight:var(--weight-semibold); cursor:pointer; }
  .dialog-foot .secondary { border:1px solid var(--border); color:var(--secondary-foreground); background:var(--secondary); }
  .dialog-foot .secondary:hover { border-color:var(--border-strong); background:var(--surface-muted); }
  .dialog-foot .primary { border:1px solid var(--primary); color:var(--primary-foreground); background:var(--primary); }
  .dialog-foot .primary:hover:not(:disabled) { border-color:var(--primary-hover); background:var(--primary-hover); }
  .dialog-foot .primary:disabled { cursor:not-allowed; opacity:.5; }
  button:focus-visible, input:focus-visible, textarea:focus-visible { outline:2px solid var(--ring); outline-offset:2px; }

  @media (prefers-reduced-motion: reduce) {
    .caption-dialog, .preview-word-active, .preview-caption { animation:none !important; }
  }

  @media (max-width:1040px) {
    .dialog-body { grid-template-columns:minmax(0, 1fr) 330px; }
    .cue-header { align-items:flex-start; flex-direction:column; gap:var(--space-3); }
  }

  @media (max-width:760px) {
    .caption-dialog { width:100vw; height:100dvh; max-width:none; max-height:none; border:0; border-radius:0; }
    .dialog-head { min-height:64px; padding:var(--space-6); }
    .dialog-body { grid-template-columns:1fr; grid-template-rows:minmax(220px, 56%) minmax(0, 44%); }
    .cue-pane { border-right:0; border-bottom:1px solid var(--border); }
    .cue-toolbar { min-height:52px; padding-inline:var(--space-6); }
    .cue-row { grid-template-columns:44px minmax(0, 1fr); }
    .cue-content { padding:var(--space-5) var(--space-6); }
    .style-heading, .caption-length { padding-inline:var(--space-6); }
    .size-after-style { margin-inline:calc(var(--space-6) * -1); padding-inline:var(--space-6); }
    fieldset { padding-inline:var(--space-6); }
    .dialog-foot { padding:var(--space-5) var(--space-6); }
    .dialog-foot > div { width:100%; }
    .dialog-foot button { flex:1; }
  }

  @media (max-width:520px) {
    .cue-timing { width:100%; justify-content:space-between; gap:var(--space-3); }
    .timing-group { min-width:0; }
    .cue-timing input { width:72px; }
  }

  @media (max-width:900px) and (orientation:landscape) {
    .caption-dialog { width:100vw; height:100dvh; max-width:none; max-height:none; border:0; border-radius:0; }
    .dialog-head { min-height:56px; padding:var(--space-5) var(--space-6); }
    .dialog-body { grid-template-columns:minmax(0, 1fr) minmax(280px, 35vw); grid-template-rows:minmax(0, 1fr); }
    .cue-pane { border-right:1px solid var(--border); border-bottom:0; }
    .cue-toolbar, .style-heading { min-height:48px; }
    .cue-content { padding:var(--space-4) var(--space-5); }
    .cue-content textarea { min-height:44px; }
    .caption-length { min-height:48px; }
    .style-section { padding-block:var(--space-6); }
    .dialog-foot { min-height:56px; padding-block:var(--space-4); }
  }

  @media (pointer:coarse) {
    .icon-button, .selection-actions button, .style-toggle-row button, .dialog-foot button { min-height:44px; }
    .icon-button { width:44px; }
    .cue-select input { width:20px; height:20px; }
    .cue-timing input, fieldset input { min-height:40px; }
  }
</style>
