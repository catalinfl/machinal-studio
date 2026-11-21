<script lang="ts">
  import ChannelRow from './ChannelRow.svelte'
  import ContextMenu from './ContextMenu.svelte'
  import RenderMenu from './RenderMenu.svelte'
  import TextTrack from './TextTrack.svelte'
  import WorkspaceExpandButton from './WorkspaceExpandButton.svelte'
  import { useTimeline, type TimelineProps } from '../composables/useTimeline.svelte'
  import { CLIP_AREA_HEIGHT } from '../stores/editor.svelte'

  let props: TimelineProps = $props()
  // The composable reads this reactive props proxy from its own rune scope.
  // svelte-ignore state_referenced_locally
  const timeline = useTimeline(props)

</script>

<section class="tl" class:headers-collapsed={!timeline.showTrackHeaders}>
  <header class="tl-toolbar">
    <div class="tc-wrap">
      <span class="tc-label">Position</span>
      <span class="tc">{timeline.fmt(timeline.editor.currentTime)}</span>
      <span class="tc-divider" aria-hidden="true">/</span>
      <span class="tc-dim">{timeline.fmt(timeline.editor.totalDuration)}</span>
      <div class="mobile-history" aria-label="Edit history">
        <button class="tbtn" onclick={() => timeline.editor.undo()} disabled={!timeline.editor.canUndo} aria-label="Undo last edit"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 6 3.5 9.5 7 13M4 9.5h7a5 5 0 0 1 5 5v1" /></svg></button>
        <button class="tbtn" onclick={() => timeline.editor.redo()} disabled={!timeline.editor.canRedo} aria-label="Redo last edit"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m13 6 3.5 3.5L13 13M16 9.5H9a5 5 0 0 0-5 5v1" /></svg></button>
      </div>
    </div>
    <div class="playback-tools">
      <div class="transport" aria-label="Playback controls">
        <button class="tbtn" onclick={timeline.goToStart} aria-label="Go to start" title="Start"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 5v10M15 5l-7 5 7 5z" /></svg></button>
        <button class="tbtn" onclick={timeline.stepBackward} aria-label="Previous frame" title="Prev frame"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m14 5-7 5 7 5z" /></svg></button>
        <button class="tbtn play" onclick={timeline.togglePlay} aria-label="Play / Pause" title="Play / Pause">
          {#if timeline.editor.playing}<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6.5 5v10M13.5 5v10" /></svg>{:else}<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m7 5 8 5-8 5z" /></svg>{/if}
        </button>
        <button class="tbtn" onclick={timeline.stepForward} aria-label="Next frame" title="Next frame"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 5 7 5-7 5z" /></svg></button>
        <button class="tbtn" onclick={timeline.goToEnd} aria-label="Go to end" title="End"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M15 5v10M5 5l7 5-7 5z" /></svg></button>
      </div>
      <button class="tbtn split" onclick={timeline.splitAtPlayhead} disabled={timeline.mediaProcessing.active} aria-label="Split at playhead" title={timeline.mediaProcessing.active ? 'Wait for the clip audio to finish loading' : 'Split at playhead (C)'}><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="14" r="2.5"/><path d="m8 7.5 7 5M8 12.5l7-5" /></svg></button>
    </div>
    <div class="spacer"></div>
    <div class="toolbar-tools">
      {#if props.onToggleExpand}
        <WorkspaceExpandButton target="timeline" expanded={props.expanded} onToggle={props.onToggleExpand} />
      {/if}
      <div class="zoom">
        <svg class="zoom-icon" viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="4.5"/><path d="m12 12 4 4M6.5 8.5h4"/></svg>
        <input
          id="timeline-zoom"
          type="range"
          min="10"
          max="200"
          step="10"
          value={timeline.editor.pixelsPerSecond}
          oninput={timeline.setZoom}
          aria-label="Timeline zoom"
          title="Timeline zoom: {timeline.editor.pixelsPerSecond} px/s"
        />
        <output for="timeline-zoom">{timeline.editor.pixelsPerSecond}<span class="zu">px/s</span></output>
        <svg class="zoom-icon" viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="4.5"/><path d="m12 12 4 4M6.5 8.5h4M8.5 6.5v4"/></svg>
      </div>
      <button
        class="track-toggle"
        onclick={timeline.toggleTrackHeaders}
        aria-controls="timeline-track-headers"
        aria-pressed={timeline.showTrackHeaders}
        title={timeline.showTrackHeaders ? 'Hide track headers' : 'Show track headers'}
      >
        <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="4" width="14" height="12" rx="1"/><path d={timeline.showTrackHeaders ? 'M8 4v12' : 'M5.5 7h3M5.5 10h3M5.5 13h3'} /></svg>
        <span>{timeline.showTrackHeaders ? 'Hide tracks' : 'Show tracks'}</span>
      </button>
    </div>
    {#if !props.hideExport}<div class="render-slot"><RenderMenu onRequireAccess={props.onRequireServerAccess} /></div>{/if}
  </header>

  <div class="tl-body" bind:this={timeline.elements.bodyEl} ondragover={timeline.onScrollDragOver} role="none">
    <div class="tl-content" class:inspector-open={timeline.inspectorOpen}>
      <div id="timeline-track-headers" class="tl-left">
        <div class="tl-corner">
          <span class="corner-label">TIMELINE</span>
          <div class="corner-adds" aria-label="Add track">
            <button class="add video" onclick={timeline.addVideoChannel} title="Add video track">
              <span class="sr-only">+V</span>
              <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3.5" y="5" width="10" height="10" rx="1"/><path d="m13.5 8 3-1.5v7l-3-1.5M8.5 7.5v5M6 10h5"/></svg>
            </button>
            <button class="add audio" onclick={timeline.addAudioChannel} title="Add audio track">
              <span class="sr-only">+A</span>
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h2M8 7v6M11 5v10M14 8v4M17 9v2"/><path d="M3.5 4.5h4M5.5 2.5v4"/></svg>
            </button>
          </div>
        </div>
        <div class="tl-headers">
          {#if timeline.editor.textItems.length > 0}
            <div class="thead text" style="height:{timeline.textTrackHeight}px">
              <span class="track-identity">
                <span class="ti">T</span>
                <span class="text-identity">
                  <span class="tn">Text</span>
                  <span class="track-note">Global overlay</span>
                </span>
              </span>
            </div>
          {/if}
          {#each timeline.editor.channels as ch (ch.id)}
            <div
              class="thead {ch.type}"
              style:height="calc(var(--timeline-clip-height, {CLIP_AREA_HEIGHT}px) + {timeline.rowHeight(ch) - CLIP_AREA_HEIGHT}px)"
              class:muted={ch.muted}
              class:hidden={ch.hidden}
               class:locked={ch.locked}
               class:selected={timeline.editor.selectedChannelIds.includes(ch.id)}
               data-channel-id={ch.id}
               onclick={timeline.selectChannel}
               oncontextmenu={timeline.openChannelContextMenu}
               onkeydown={timeline.onChannelKey}
              role="button"
              tabindex="0"
              aria-pressed={timeline.editor.selectedChannelIds.includes(ch.id)}
            >
              <span class="track-identity">
                <span class="ti" aria-hidden="true">
                  {#if ch.type === 'video'}
                    <svg viewBox="0 0 20 20"><rect x="3.5" y="5" width="13" height="10" rx="1"/><path d="m8.5 8 4 2-4 2z"/></svg>
                  {:else}
                    <svg viewBox="0 0 20 20"><path d="M4 10h1.5M7.5 7v6M10.5 4.5v11M13.5 6.5v7M16.5 9v2"/></svg>
                  {/if}
                </span>
                <span class="tn">{ch.name}</span>
              </span>
              <div class="tbtns">
                <button class="mini" data-channel-id={ch.id} class:active={ch.muted} onclick={timeline.toggleMute} title="Mute" aria-label="Mute {ch.name}" aria-pressed={ch.muted}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 8v4h3l4 3V5L7 8H4zM14 8l3 4M17 8l-3 4"/></svg></button>
                <button class="mini" data-channel-id={ch.id} class:active={ch.locked} onclick={timeline.toggleLock} title="Lock" aria-label="Lock {ch.name}" aria-pressed={ch.locked}><svg viewBox="0 0 20 20" aria-hidden="true"><rect x="4.5" y="8.5" width="11" height="8" rx="1"/><path d="M7 8.5V6a3 3 0 0 1 6 0v2.5"/></svg></button>
                <button class="mini del" data-channel-id={ch.id} onclick={timeline.removeChannel} title="Remove" aria-label="Remove {ch.name}"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4.5 6h11M8 3.5h4M6.5 6l.6 10h5.8l.6-10M8.5 8.5v5M11.5 8.5v5"/></svg></button>
              </div>
            </div>
          {/each}
          {#if timeline.editor.channels.length === 0}
            <div class="thead empty"><span class="tn">No tracks. Add with +V / +A</span></div>
          {/if}
        </div>
      </div>

      <div
        class="tl-right"
        class:text-drop-active={timeline.textDropActive}
        onpointerdown={timeline.onTimelinePointerDown}
        oncontextmenu={timeline.onTimelineContextMenu}
        ondragover={timeline.onTextDragOver}
        ondragleave={timeline.onTextDragLeave}
        ondrop={timeline.onTextDrop}
        role="application"
        aria-label="Timeline clip selection area"
      >
        <div class="tl-ruler-viewport">
          <div
            class="tl-ruler"
            bind:this={timeline.elements.rulerEl}
            style:width="{timeline.timelineCanvasWidth}px"
            onclick={timeline.onRulerClick}
            onkeydown={timeline.onRulerKey}
            role="slider"
            tabindex="0"
            aria-label="Timeline ruler"
            aria-valuemin="0"
            aria-valuemax={parseFloat(Math.max(timeline.editor.totalDuration, 10).toFixed(3))}
            aria-valuenow={parseFloat(timeline.editor.currentTime.toFixed(3))}
            aria-valuetext="{timeline.fmt(timeline.editor.currentTime)} of {timeline.fmt(timeline.editor.totalDuration)}"
          >
            {#each timeline.visibleRulerMarks as m (m.t)}
              <div class="mark {m.major ? 'major' : 'minor'}" style="left: {m.t * timeline.editor.pixelsPerSecond}px">
                {#if m.major}<span class="mark-label">{timeline.fmtShort(m.t)}</span>{/if}
              </div>
            {/each}
          </div>
        </div>

        <div class="tl-track-scroll" bind:this={timeline.elements.timelineScrollEl} onscroll={timeline.syncHorizontalScrollbar}>
          <div class="tl-right-canvas" style="width: {timeline.timelineCanvasWidth}px">
            <div class="tl-tracks">
            {#if timeline.editor.textItems.length > 0}
              <TextTrack
                onTextDragMove={timeline.updateAutoScroll}
                onTextDragEnd={timeline.stopAutoScroll}
                onOpenInspector={timeline.onOpenTextInspector}
                visibleRange={timeline.visibleTimeRange}
              />
            {/if}
            {#each timeline.editor.channels as ch (ch.id)}
              <ChannelRow
                channel={ch}
                onClipDragMove={timeline.updateAutoScroll}
                onClipDragEnd={timeline.stopAutoScroll}
                onClipRouted={timeline.revealRoutedClip}
                onOpenClipInspector={timeline.onOpenClipInspector}
                onOpenEffectInspector={timeline.onOpenEffectInspector}
                onClipContextMenu={timeline.openClipContextMenu}
                onEffectDragMove={timeline.updateAutoScroll}
                onEffectDragEnd={timeline.stopAutoScroll}
                onPaletteDragPreview={timeline.setPaletteDropGuide}
                onPaletteDragEnd={timeline.stopPaletteDropGuide}
                visibleRange={timeline.visibleTimeRange}
                />
              {/each}
              <div
                bind:this={timeline.elements.newTrackEl}
                class="new-track-zone"
                class:drop-active={timeline.newTrackActive}
                class:processing={timeline.processingNewTrack}
                data-new-track-zone
                ondragover={timeline.onNewTrackDragOver}
                ondragleave={timeline.onNewTrackDragLeave}
                ondrop={timeline.onNewTrackDrop}
                role="application"
                aria-label="Drop zone: create new track"
              >
                {#if timeline.editor.channels.length === 0}
                  <span class="zone-hint">Drag clips from Media Bin to add them here.</span>
                {:else if timeline.processingNewTrack && !timeline.mediaProcessing.longVideoActive}
                  <span class="zone-hint"><span class="processing-spinner" aria-hidden="true"></span>Adding your clip…</span>
                {:else}
                  <span class="zone-hint">+ Drop here to create a new track</span>
                {/if}
              </div>
            </div>

            {#if timeline.textDropActive}
              <div class="text-drop-guide" style="left:{timeline.textDropTime * timeline.editor.pixelsPerSecond}px" aria-hidden="true">
                <span>Drop text at {timeline.textDropTime.toFixed(2)}s</span>
              </div>
            {/if}

            {#if timeline.paletteDropGuide}
              <div
                class="palette-drop-guide {timeline.paletteDropGuide.kind}"
                style="left:{timeline.paletteDropGuide.time * timeline.editor.pixelsPerSecond}px"
                aria-hidden="true"
              >
                {#if timeline.paletteDropGuide.kind === 'effect'}
                  <span>Drop effect at {timeline.paletteDropGuide.time.toFixed(2)}s</span>
                {:else}
                  <span>Between {timeline.paletteDropGuide.leftClipName} and {timeline.paletteDropGuide.rightClipName}</span>
                {/if}
              </div>
            {/if}

            <div
              class="playhead"
              class:dragging={timeline.draggingPlayhead}
              style="transform: translateX({timeline.editor.currentTime * timeline.editor.pixelsPerSecond - 8}px); height: 100%"
              role="slider"
              tabindex="0"
              aria-label="Playhead"
              aria-valuemin="0"
              aria-valuemax={parseFloat(Math.max(timeline.editor.totalDuration, 10).toFixed(3))}
              aria-valuenow={parseFloat(timeline.editor.currentTime.toFixed(3))}
              aria-valuetext="{timeline.fmt(timeline.editor.currentTime)} of {timeline.fmt(timeline.editor.totalDuration)}"
              onpointerdown={timeline.onPlayheadPointerDown}
            ><span class="ph-strip"></span></div>
          </div>
        </div>
      </div>
    </div>
    <div
      class="tl-scrollbar"
      class:drag-active={timeline.dragScrollActive}
      bind:this={timeline.elements.horizontalScrollEl}
      onscroll={timeline.onHorizontalScrollbarScroll}
      role="region"
      aria-label="Timeline horizontal scroll"
    >
      <div
        class="tl-scrollbar-content"
        class:inspector-open={timeline.inspectorOpen}
        style="width: {timeline.timelineCanvasWidth}px"
      ></div>
    </div>
  </div>
  {#if timeline.marquee.rect}
    <div
      class="selection-marquee"
      style="left:{timeline.marquee.rect.left}px; top:{timeline.marquee.rect.top}px; width:{timeline.marquee.rect.width}px; height:{timeline.marquee.rect.height}px; clip-path:{timeline.marquee.clipPath}"
      aria-hidden="true"
    ></div>
  {/if}
  {#if timeline.contextMenu}
    {#key timeline.contextMenu.id}
      <ContextMenu
        x={timeline.contextMenu.x}
        y={timeline.contextMenu.y}
        title={timeline.contextMenu.title}
        detail={timeline.contextMenu.detail}
        icon={timeline.contextMenu.icon}
        items={timeline.contextMenu.items}
        onClose={timeline.closeContextMenu}
      />
    {/key}
  {/if}
</section>

<style>
  .mobile-history { display:none; }
  .tl {
    --timeline-header-width: 260px;
    display: flex; flex-direction: column;
    height: 100%; min-height: 220px;
    background: var(--background);
    border-top: 1px solid var(--border-strong);
    color: var(--foreground);
    font-family: var(--font-sans);
    isolation: isolate;
    --audio-surface: color-mix(in srgb, var(--surface) 78%, var(--background));
    --audio-waveform: color-mix(in srgb, var(--foreground) 52%, transparent);
    --audio-waveform-muted: color-mix(in srgb, var(--foreground) 24%, transparent);
    --audio-waveform-opacity: .82;
    --effect-surface: color-mix(in srgb, var(--surface-elevated) 76%, var(--surface-muted));
    --effect-border: var(--border-strong);
    --transition-surface: color-mix(in srgb, var(--surface) 84%, var(--background));
    --transition-border: var(--border-strong);
  }

  /* --- Toolbar --- */
  .tl-toolbar {
    display: flex; align-items: center; gap: var(--space-6);
    min-height: 46px;
    padding: var(--space-3) var(--space-6);
    background: var(--surface-elevated);
    border-bottom: 1px solid var(--border-strong);
    flex-shrink: 0;
    position: relative; z-index: 40;
  }
  .tc-wrap {
    display: grid;
    grid-template-columns: auto auto auto;
    grid-template-areas: 'label label label' 'current divider duration';
    align-items: baseline;
    column-gap: var(--space-2);
    min-width: 190px;
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    line-height: 1;
  }
  .tc-label {
    grid-area: label;
    margin-bottom: 3px;
    color: var(--muted-foreground);
    font: var(--weight-semibold) 8px/1 var(--font-sans);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
  }
  .tc { grid-area: current; color: var(--primary); font-size: var(--text-sm); font-weight: var(--weight-semibold); }
  .tc-divider { grid-area: divider; color: var(--border-strong); font-size: var(--text-xs); }
  .tc-dim { grid-area: duration; color: var(--muted-foreground); font-size: var(--text-xs); }
  .playback-tools { display: flex; align-items: center; gap: var(--space-3); }
  .transport {
    display: flex;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--secondary);
  }
  .toolbar-tools { display: flex; align-items: center; gap: var(--space-4); }
  .render-slot { display: block; }
  .tbtn {
    width: 30px; height: 30px;
    padding: 0;
    border: 0; border-right: 1px solid var(--border); background: transparent;
    color: var(--muted-foreground); border-radius: 0; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: color 120ms ease, background-color 120ms ease, border-color 120ms ease;
  }
  .transport .tbtn:last-child { border-right: 0; }
  .tbtn:hover { background: var(--surface-muted); color: var(--foreground); }
  .tbtn:disabled { cursor: not-allowed; opacity: .45; }
  .tbtn svg, .track-toggle svg, .add svg, .mini svg, .zoom-icon {
    width: var(--icon-sm); height: var(--icon-sm);
    fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round;
  }
  .tbtn.play {
    background: var(--primary);
    color: var(--primary-foreground); border-color: var(--primary);
  }
  .tbtn.play:hover { background: var(--primary-hover); border-color: var(--primary-hover); }
  .tbtn.split {
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--secondary);
    color: var(--secondary-foreground);
  }
  .tbtn.split:hover { border-color: var(--border-strong); background: var(--surface-muted); }
  .tbtn:focus-visible, .add:focus-visible, .track-toggle:focus-visible { position: relative; z-index: 2; outline: 2px solid var(--ring); outline-offset: 2px; }
  .spacer { flex: 1; }
  .sr-only {
    position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
    overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
  }
  .corner-adds {
    display: flex; align-items: center;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: var(--radius-xs);
  }
  .add {
    width: 27px; height: 20px;
    display: grid; place-items: center;
    padding: 0; border: 0; border-right: 1px solid var(--border); border-radius: 0; cursor: pointer;
    background: var(--surface-elevated); color: var(--muted-foreground);
    transition: color 120ms ease, background-color 120ms ease;
  }
  .add:last-child { border-right: 0; }
  .add:hover { background: var(--primary-subtle); color: var(--primary); }
  .add svg { width: 13px; height: 13px; }
  .track-toggle {
    display: none;
    align-items: center; justify-content: center; gap: 5px;
    min-height: 30px; padding: 4px 8px;
    border: 1px solid var(--border); border-radius: var(--radius-sm);
    background: var(--secondary); color: var(--secondary-foreground);
    font-size: var(--text-2xs); cursor: pointer; white-space: nowrap;
  }
  .track-toggle[aria-pressed="true"] { border-color: var(--primary-border); background: var(--primary-subtle); color: var(--primary); }
  .track-toggle:hover, .track-toggle[aria-pressed="false"] { background: var(--surface-muted); color: var(--foreground); }
  .track-toggle[aria-pressed="false"]:hover { border-color: var(--primary-border); color: var(--primary); }
  .zoom {
    display: flex; align-items: center; gap: 8px;
    min-height: 30px;
    padding: 0 var(--space-4);
    border-left: 1px solid var(--border);
    border-right: 1px solid var(--border);
    color: var(--muted-foreground);
  }
  .zoom-icon { flex: 0 0 auto; width: 12px; height: 12px; }
  .zoom input[type=range] {
    width: 104px; height: 22px; cursor: ew-resize;
  }
  .zoom output {
    min-width: 53px; color: var(--foreground); font-size: var(--text-2xs); font-weight: var(--weight-semibold);
    font-family: var(--font-mono); text-align: right;
  }
  .zu { margin-left: 2px; font-size: 8px; color: var(--muted-foreground); }
  /* --- Body: vertical scroll for the complete timeline --- */
  .tl-body {
    flex: 1; min-height: 0;
    overflow-x: hidden;
    overflow-y: auto;
    background: var(--background);
  }
  .tl-content {
    display: flex;
    min-width: 100%;
    min-height: 100%;
  }
  .tl-content.inspector-open {
    box-sizing: content-box;
  }

  /* Left column: stays outside the horizontal track scroller */
  .tl-left {
    width: var(--timeline-header-width); flex-shrink: 0;
    box-sizing: border-box;
    position: relative; z-index: 40;
    background: var(--surface);
    border-right: 1px solid var(--border-strong);
  }
  .tl-corner {
    height: 26px;
    box-sizing: border-box; /* height includes the border, matches the ruler */
    position: sticky; top: 0; z-index: 45;
    background: var(--surface-elevated);
    border-bottom: 1px solid var(--border-strong);
    display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 0 8px;
  }
  .corner-label {
    color: var(--muted-foreground);
    font-size: 9px; letter-spacing: var(--tracking-label); font-weight: var(--weight-semibold);
  }
  .thead {
    min-height: var(--timeline-clip-height, 64px);
    box-sizing: border-box;
    position: relative;
    display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center;
    gap: var(--space-5); padding: 0 var(--space-6);
    border-bottom: 1px solid var(--border);
    background: var(--surface);
    cursor: default;
    transition: background-color 120ms ease;
  }
  .thead.video { background: var(--surface); }
  .thead.audio { background: color-mix(in srgb, var(--surface) 78%, var(--background)); }
  .thead:hover { background: color-mix(in srgb, var(--surface-muted) 50%, var(--surface)); }
  .thead.selected { background: var(--primary-subtle); }
  .thead.selected::before {
    content: '';
    position: absolute; inset: 0 auto 0 0;
    width: 1px;
    background: var(--primary);
  }
  .thead.audio.selected { background: var(--primary-subtle); }
  .thead.selected .ti { border-color: var(--primary-border); color: var(--primary); background: var(--surface-elevated); }
  .thead:focus-visible { outline: 2px solid var(--ring); outline-offset: -2px; }
  .thead.text { min-height: 42px; background: color-mix(in srgb, var(--surface-muted) 58%, var(--surface)); }
  .thead.text .ti { width: 22px; height: 22px; color: var(--foreground); font: 700 9px var(--font-mono); }
  .text-identity { display: flex; min-width: 0; flex-direction: column; gap: 2px; }
  .track-note { color: var(--muted-foreground); font-size: 9px; }
  .thead.muted .track-identity { color: var(--muted-foreground); }
  .thead.muted .tn { color: var(--muted-foreground); }
  .thead.hidden { display: none; }
  .thead.locked { background-image: repeating-linear-gradient(-45deg, transparent 0 5px, color-mix(in srgb, var(--border) 18%, transparent) 5px 6px); }
  .thead.empty { display: flex; align-items: center; justify-content: center; color: var(--muted-foreground); font-size: 11px; text-align: center; }
  .track-identity { display: flex; align-items: center; gap: var(--space-5); min-width: 0; }
  .ti {
    width: 24px; height: 24px;
    display: grid; place-items: center; flex: 0 0 auto;
    border: 1px solid var(--border);
    border-radius: var(--radius-xs);
    color: var(--muted-foreground);
    background: var(--surface-elevated);
  }
  .ti svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 1.45; stroke-linecap: round; stroke-linejoin: round; }
  .tn { min-width: 0; color: var(--foreground); font-size: var(--text-xs); font-weight: var(--weight-semibold); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tbtns {
    display: flex;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: var(--radius-xs);
  }
  .mini {
    width: 25px; height: 24px;
    padding: 0;
    border: 0; border-right: 1px solid var(--border); background: var(--surface-elevated);
    color: var(--muted-foreground); border-radius: 0; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: color 120ms ease, background-color 120ms ease;
  }
  .mini:last-child { border-right: 0; }
  .mini svg { width: 13px; height: 13px; }
  .mini:hover { background: var(--surface-muted); color: var(--foreground); }
  .mini:focus-visible { outline: 2px solid var(--ring); outline-offset: 1px; }
  .mini.active { background: var(--primary); color: var(--primary-foreground); border-color: var(--primary); }
  .mini.del:hover { background: var(--destructive); border-color: var(--destructive); color: var(--destructive-foreground); }

  /* Right column: a body-sticky ruler above the horizontally scrollable tracks */
  .tl-right {
    flex: 1; min-width: 0;
    position: relative;
    display: flex; flex-direction: column;
  }
  .tl-ruler-viewport {
    position: sticky; top: 0; z-index: 30;
    height: 26px; flex-shrink: 0;
    overflow: hidden;
    background: var(--surface-elevated);
    border-bottom: 1px solid var(--border-strong);
    box-shadow: inset 0 -1px color-mix(in srgb, var(--border-strong) 24%, transparent);
  }
  .tl-track-scroll {
    flex: 1; min-height: 0;
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none;
  }
  .tl-track-scroll::-webkit-scrollbar { height: 0; }
  .tl-scrollbar {
    position: sticky;
    bottom: 0;
    z-index: 50;
    width: calc(100% - var(--timeline-header-width));
    height: 14px;
    margin: -14px 0 0 var(--timeline-header-width);
    overflow-x: auto;
    overflow-y: hidden;
    border-top: 1px solid var(--border);
    background: var(--surface);
    scrollbar-color: var(--border-strong) var(--surface);
  }
  .tl-scrollbar-content {
    height: 1px;
    min-width: 100%;
  }
  .tl-scrollbar-content.inspector-open {
    box-sizing: content-box;
    padding-right: min(var(--panel-sm), 92vw);
  }
  .tl-scrollbar::-webkit-scrollbar { height: 14px; }
  .tl-scrollbar.drag-active { scrollbar-width: none; }
  .tl-scrollbar.drag-active::-webkit-scrollbar { height: 0; }
  .tl-scrollbar::-webkit-scrollbar-track { background: var(--surface); }
  .tl-scrollbar::-webkit-scrollbar-thumb {
    border: 3px solid var(--surface);
    border-radius: var(--radius-pill);
    background: var(--border-strong);
  }
  .tl-scrollbar::-webkit-scrollbar-thumb:hover { background: var(--primary); }
  .tl-right-canvas {
    position: relative;
    display: flex; flex-direction: column;
    min-width: 100%; min-height: 100%;
  }
  .tl-content.inspector-open .tl-right-canvas {
    box-sizing: content-box;
    padding-right: min(var(--panel-sm), 92vw);
  }
  .tl-content.inspector-open .tl-ruler {
    box-sizing: content-box;
    padding-right: min(var(--panel-sm), 92vw);
  }
  .tl-right.text-drop-active { background:var(--primary-subtle); }
  .text-drop-guide { position:absolute; top:0; bottom:0; z-index:18; width:2px; pointer-events:none; background:var(--primary); }
  .text-drop-guide span { position:absolute; top:31px; left:7px; padding:4px 7px; border:1px solid var(--primary); border-radius:var(--radius-xs); color:var(--primary-foreground); background:var(--primary); font:9px var(--font-mono); white-space:nowrap; box-shadow:0 5px 14px rgb(22 29 36 / 18%); }
  .palette-drop-guide { position:absolute; top:0; bottom:0; z-index:19; width:2px; pointer-events:none; }
  .palette-drop-guide span { position:absolute; top:31px; left:8px; padding:4px 7px; border-radius:var(--radius-xs); font:9px var(--font-mono); white-space:nowrap; box-shadow:0 5px 14px rgb(22 29 36 / 18%); }
  .palette-drop-guide.effect { background:var(--primary); }
  .palette-drop-guide.effect::before { content:''; position:absolute; top:0; left:-6px; width:14px; height:12px; background:var(--primary); clip-path:polygon(0 0,100% 0,50% 100%); }
  .palette-drop-guide.effect span { border:1px solid var(--primary); color:var(--primary-foreground); background:var(--primary); }
  .palette-drop-guide.transition { width:0; border-left:2px dashed var(--primary); }
  .palette-drop-guide.transition span { border:1px solid var(--primary); color:var(--primary-foreground); background:var(--primary); }
  .tl-ruler {
    position: relative;
    height: 26px;
    box-sizing: border-box;
    background: linear-gradient(to bottom, transparent 0 19px, color-mix(in srgb, var(--border) 46%, transparent) 19px 20px, transparent 20px);
    cursor: pointer;
  }
  .tl-ruler:focus-visible { outline: 2px solid var(--ring); outline-offset: -2px; }
  .mark { position: absolute; top: 16px; bottom: 0; width: 1px; background: var(--border); }
  .mark.major { top: 11px; background: var(--border-strong); }
  .mark-label {
    position: absolute; top: -9px; left: 4px;
    color: var(--muted-foreground); font: 9px/1 var(--font-mono);
    white-space: nowrap; pointer-events: none;
  }

  .tl-tracks {
    position: relative;
    flex: 1;
    display: flex;
    flex-direction: column;
  }
  .new-track-zone {
    flex: 1;
    min-height: 88px;
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    background-image: repeating-linear-gradient(-45deg, transparent 0 12px, color-mix(in srgb, var(--border) 14%, transparent) 12px 13px);
  }
  .zone-hint {
    color: var(--muted-foreground); font-size: 12px;
    padding: var(--space-5) var(--space-8);
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--background) 90%, transparent);
    text-align: center;
    pointer-events: none;
    opacity: 0;
    transition: opacity 120ms ease;
  }
  .new-track-zone:hover .zone-hint,
  .new-track-zone.drop-active .zone-hint { opacity: 1; }
  .new-track-zone.drop-active::before {
    content: '';
    position: absolute; inset: 2px;
    border: 1px dashed var(--primary);
    border-radius: var(--radius-sm);
    pointer-events: none;
    background: var(--primary-subtle);
  }
  .new-track-zone.processing .zone-hint {
    display: inline-flex;
    align-items: center;
    gap: var(--space-3);
    opacity: 1;
    padding: var(--space-2) var(--space-4);
    border: 1px solid var(--primary-border);
    border-radius: var(--radius-xs);
    color: var(--foreground);
    background: var(--surface-elevated);
    box-shadow: var(--shadow-object);
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
  }
  .processing-spinner {
    width: 11px; height: 11px;
    border: 2px solid var(--border);
    border-top-color: var(--primary);
    border-radius: var(--radius-pill);
    animation: processing-spin .8s linear infinite;
  }
  @keyframes processing-spin { to { transform: rotate(360deg); } }

  .playhead {
    position: absolute; top: 0; bottom: 0; left: 0;
    width: 18px;
    transform: translateX(-8px);
    /* Above clips, text and effects so the line always passes through them,
       but pointer-events: none — only the narrow strip and the triangle are
       grabbable, so items underneath stay clickable. */
    z-index: 35; pointer-events: none;
    cursor: ew-resize;
  }
  .playhead.dragging { cursor: grabbing; }
  .ph-strip {
    position: absolute;
    top: 0; bottom: 0; left: 6px;
    width: 6px;
    pointer-events: auto;
  }
  .playhead::before {
    content: ''; position: absolute;
    top: 0; left: 1px;
    width: 16px; height: 11px;
    background: var(--primary);
    clip-path: polygon(0 0, 100% 0, 100% 5px, 50% 100%, 0 5px);
    pointer-events: auto;
    filter: drop-shadow(0 2px 2px rgb(22 29 36 / 18%));
  }
  .playhead::after {
    content: ''; position: absolute;
    top: 9px; bottom: 0; left: 8px;
    width: 2px;
    background: var(--primary);
    pointer-events: none;
  }
  .selection-marquee {
    position: fixed;
    z-index: 10;
    box-sizing: border-box;
    border: 1px solid var(--primary);
    background: color-mix(in srgb, var(--primary) 16%, transparent);
    pointer-events: none;
  }
  .playhead:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }

  @media (max-width: 1024px) {
    .tl { min-height: 0; --timeline-header-width: 120px; }
    .tl-toolbar {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      grid-template-areas:
        'time render'
        'playback playback'
        'tools tools';
      gap: 6px 8px;
      padding: 6px 8px;
      overflow: hidden;
      min-width: 0;
    }
    .tc-wrap { grid-area: time; min-width: 0; overflow: hidden; }
    .playback-tools { grid-area: playback; min-width: 0; overflow-x: auto; scrollbar-width: none; }
    .playback-tools::-webkit-scrollbar { display: none; }
    .transport { flex: 0 0 auto; }
    .render-slot { display: block; grid-area: render; justify-self: end; min-width: 0; }
    .toolbar-tools {
      grid-area: tools;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      min-width: 0;
    }
    .tc-dim, .tc-divider, .spacer, .zoom output { display: none; }
    .tbtn { width: 34px; height: 34px; }
    .corner-label { display: none; }
    .corner-adds { margin-inline: auto; }
    .add { width: 28px; height: 22px; }
    .zoom { flex: 1 1 auto; min-width: 0; justify-content: center; padding: 0 var(--space-3); }
    .zoom input[type=range] { width: min(120px, 100%); }
    .track-toggle { display: inline-flex; flex: 0 0 auto; height: 34px; }
    .tl-corner { justify-content: center; padding: 0 var(--space-3); }
    .thead { grid-template-columns: minmax(0, 1fr); align-content: center; gap: 3px; padding: 0 6px; }
    .track-identity { gap: var(--space-3); }
    .ti { width: 19px; height: 19px; }
    .ti svg { width: 12px; height: 12px; }
    .track-note { display: none; }
    .tn { font-size: 10px; }
    .mini { width: 27px; height: 27px; font-size: 10px; }
    .thead.text .track-identity { grid-column: 1 / -1; }
    .zone-hint { max-width: 180px; font-size: 10px; }
    .headers-collapsed .tl-left { display: none; }
    .tl-content.inspector-open .tl-right-canvas { padding-right: 0; }
    .tl-scrollbar-content.inspector-open { padding-right: 0; }
    .tl-content.inspector-open .tl-ruler { padding-right: 0; }
  }

  @media (max-width: 380px) {
    .tl { --timeline-header-width: 106px; }
    .mini { width: 25px; height: 25px; }
    .tc-wrap { font-size: 11px; }
  }

  @media (min-width: 761px) and (max-width: 1024px) {
    .tl { --timeline-header-width: 180px; }
    .thead { grid-template-columns: minmax(0, 1fr) auto; gap: var(--space-5); padding: 0 var(--space-6); }
    .track-note { display: block; }
    .tn { font-size: var(--text-xs); }
  }

  .headers-collapsed .tl-scrollbar { width: 100%; margin-left: 0; }

  @media (pointer: coarse) {
    .tbtn { width: 40px; height: 40px; }
    .tl-corner, .tl-ruler-viewport, .tl-ruler { height: 40px; }
    .tl-ruler { background-position-y: 14px; }
    .mark { top: 29px; }
    .mark.major { top: 21px; }
    .mark-label { top: -14px; }
    .add { width: 40px; min-height: 40px; }
    .add svg { width: var(--icon-md); height: var(--icon-md); }
    .track-toggle { min-height: 40px; }
    .mini { width: 32px; height: 32px; }
    .zoom input[type=range]::-webkit-slider-thumb { width: 20px; height: 20px; }
    .zoom input[type=range]::-moz-range-thumb { width: 18px; height: 18px; }
  }

  @media (max-width: 900px) and (orientation: landscape) and (max-height: 500px) {
    .tl-toolbar {
      grid-template-columns: auto minmax(0, 1fr) auto;
      grid-template-areas: 'time playback render' 'tools tools tools';
    }
    .playback-tools { justify-content: center; }
    .toolbar-tools { justify-content: flex-end; }
  }
</style>
