<script lang="ts">
  import { useTopBar } from '../composables/useTopBar.svelte'
  import BrandMark from './BrandMark.svelte'
  import CompositionMenu from './CompositionMenu.svelte'
  import SessionMenu from './SessionMenu.svelte'
  import RenderMenu from './RenderMenu.svelte'
  import ProjectsMenu from './ProjectsMenu.svelte'
  import type { useProjects } from '../composables/useProjects.svelte'
  import type { AIFeature } from '../lib/ai-access'

  interface Props {
    projects?: ReturnType<typeof useProjects>
    toolNavigation?: boolean
    showMediaBin?: boolean
    showEffects?: boolean
    showPresets?: boolean
    showTransitions?: boolean
    showText?: boolean
    showSpeech?: boolean
    showImage?: boolean
    showAI?: boolean
    onToggleMediaBin?: () => void
    onToggleEffects?: () => void
    onTogglePresets?: () => void
    onToggleTransitions?: () => void
    onToggleText?: () => void
    onToggleSpeech?: () => void
    onToggleImage?: () => void
    onToggleAI?: () => void
    onGenerateScenes?: () => void
    onRequireServerAccess?: (feature: AIFeature) => void
  }

  let {
    projects,
    toolNavigation = true,
    showMediaBin = true,
    showEffects = true,
    showPresets = false,
    showTransitions = false,
    showText = false,
    showSpeech = false,
    showImage = false,
    showAI = false,
     onToggleMediaBin,
     onToggleEffects,
     onTogglePresets,
     onToggleTransitions,
     onToggleText,
     onToggleSpeech,
     onToggleImage,
      onToggleAI,
       onGenerateScenes,
       onRequireServerAccess,
   }: Props = $props()
  const topbar = useTopBar({
    getShowMediaBin: () => showMediaBin, getShowEffects: () => showEffects, getShowPresets: () => showPresets, getShowTransitions: () => showTransitions,
    getShowText: () => showText, getShowSpeech: () => showSpeech, getShowImage: () => showImage, getShowAI: () => showAI,
    getOnToggleMediaBin: () => onToggleMediaBin, getOnToggleEffects: () => onToggleEffects, getOnTogglePresets: () => onTogglePresets,
    getOnToggleTransitions: () => onToggleTransitions, getOnToggleText: () => onToggleText, getOnToggleSpeech: () => onToggleSpeech,
    getOnToggleImage: () => onToggleImage, getOnToggleAI: () => onToggleAI,
  })
</script>

<svelte:window onclick={topbar.onWindowClick} onkeydown={topbar.onWindowKeydown} />

<header class="topbar" class:command={!toolNavigation}>
  <div class="left">
    <a class="brand" href="/" aria-label="machinal home"><BrandMark size={24} /><span class="brand-name">machinal</span></a>
    {#if !toolNavigation}<span class="workspace-name">Video editor</span>{/if}
    {#if toolNavigation}<div class="panel-menu">
        <button
          class="menu panel-more"
           onclick={topbar.togglePanelMenu}
           bind:this={topbar.panelMenuButton}
          aria-label="Open editor panels"
          aria-haspopup="true"
           aria-expanded={topbar.panelMenuOpen}
        >
           <span>{topbar.panelLabel}</span>
          <svg class="chev" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>
        </button>
          <nav class="menus" class:open={topbar.panelMenuOpen} aria-label="Editor panels">
          <button
           class="menu panel-toggle"
           class:active={showMediaBin}
          aria-pressed={showMediaBin}
          aria-controls="media-bin-panel"
           disabled={topbar.mediaProcessing.active}
           title={topbar.mediaProcessing.active ? 'Media Bin is busy adding a clip' : undefined}
           onclick={topbar.panelAction(onToggleMediaBin)}
         ><svg class="panel-icon" viewBox="0 0 20 20" aria-hidden="true"><rect x="2.5" y="3" width="15" height="14" rx="2"/><path d="M2.5 7h15M7 7v10"/></svg><span>Media Bin</span></button>
         <button
           class="menu panel-toggle"
           class:active={showText}
           aria-pressed={showText}
           aria-controls="text-panel"
            onclick={topbar.panelAction(onToggleText)}
          ><svg class="panel-icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M4 4h12M10 4v12M7 16h6"/></svg><span>Text</span></button>
        <button
          class="menu panel-toggle"
          class:active={showEffects}
          aria-pressed={showEffects}
          aria-controls="effects-panel"
           onclick={topbar.panelAction(onToggleEffects)}
        ><svg class="panel-icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2.5l1.3 4.2L15.5 8l-4.2 1.3L10 13.5 8.7 9.3 4.5 8l4.2-1.3L10 2.5zM15.5 12.5l.6 1.9 1.9.6-1.9.6-.6 1.9-.6-1.9-1.9-.6 1.9-.6.6-1.9z"/></svg><span>Effects</span></button>
        <button
          class="menu panel-toggle"
          class:active={showPresets}
          aria-pressed={showPresets}
          aria-controls="presets-panel"
            onclick={topbar.panelAction(onTogglePresets)}
         ><svg class="panel-icon" viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="3" width="11" height="11" rx="2"/><path d="M7 17h8a2 2 0 002-2V7"/></svg><span>Styles</span></button>
         <button
           class="menu panel-toggle"
           class:active={showSpeech}
           aria-pressed={showSpeech}
           aria-controls="text-to-speech-panel"
            onclick={topbar.panelAction(onToggleSpeech)}
         >
           <svg class="panel-icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M3 7.5v5M6 5v10M9 8.5v3M12 6.5v7M15 4v12M18 8v4"/></svg><span>Text to Speech</span>
         </button>
         <button
          class="menu panel-toggle"
          class:active={showTransitions}
          aria-pressed={showTransitions}
          aria-controls="transitions-panel"
            onclick={topbar.panelAction(onToggleTransitions)}
         ><svg class="panel-icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M3 6h11M11 3l3 3-3 3M17 14H6M9 11l-3 3 3 3"/></svg><span>Transitions</span></button>
         <button
           class="menu panel-toggle"
           class:active={showImage}
           aria-pressed={showImage}
           aria-controls="image-panel"
            onclick={topbar.panelAction(onToggleImage)}
          ><svg class="panel-icon" viewBox="0 0 20 20" aria-hidden="true"><rect x="2.5" y="3" width="15" height="14" rx="2"/><path d="m4.5 14 3.8-4 2.5 2.4 1.8-1.8 2.9 3.4M13.5 7h.01"/></svg><span>Image</span></button>
         <button
           class="menu panel-toggle"
           class:active={showAI}
           aria-pressed={showAI}
           aria-controls="ai-panel"
            onclick={topbar.panelAction(onToggleAI)}
          ><svg class="panel-icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2.5 11.4 7l4.6 1.4-4.6 1.4L10 14.5 8.6 9.8 4 8.4 8.6 7 10 2.5Z"/><path d="m15.5 13 .5 1.6 1.5.4-1.5.5-.5 1.5-.5-1.5-1.5-.5 1.5-.4.5-1.6Z"/></svg><span>AI Edit</span></button>
        </nav>
    </div>{/if}
  </div>
  <div class="center">
     <span class="timecode">{topbar.formatTimecode(topbar.editor.currentTime, topbar.editor.fps)}</span>
    <span class="sep">/</span>
     <span class="timecode dim">{topbar.formatTimecode(topbar.editor.totalDuration, topbar.editor.fps)}</span>
  </div>
  <div class="right">
    {#if projects}<ProjectsMenu {projects} />{/if}
    {#if onGenerateScenes}<button type="button" class="generate-scenes" onclick={onGenerateScenes} aria-label="Generate scenes" aria-haspopup="dialog" title="Generate scenes"><svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2.5" y="4" width="15" height="12" rx="1"/><path d="M2.5 8h15M6 4v4m4-4v4m4-4v4m-6 2 4 2-4 2z"/></svg><span>Generate scenes</span></button>{/if}
    {#if toolNavigation}<CompositionMenu />{/if}
    <div class="history" aria-label="Edit history">
       <button class="history-btn" onclick={topbar.undo} disabled={!topbar.editor.canUndo} aria-label="Undo last edit" title="Undo last edit (Ctrl+Z)">
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 6 3.5 9.5 7 13M4 9.5h7a5 5 0 0 1 5 5v1" /></svg>
      </button>
       <button class="history-btn" onclick={topbar.redo} disabled={!topbar.editor.canRedo} aria-label="Redo last edit" title="Redo last edit (Ctrl+Shift+Z)">
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m13 6 3.5 3.5L13 13M16 9.5H9a5 5 0 0 0-5 5v1" /></svg>
      </button>
    </div>
      <span class="fps"><span class="num">{topbar.editor.fps}</span> fps</span>
      <SessionMenu command />
      {#if !toolNavigation}<div class="header-export"><RenderMenu onRequireAccess={onRequireServerAccess} /></div>{/if}
    </div>
</header>

<style>
  .topbar {
    display: flex; align-items: center; justify-content: space-between;
    height: var(--height-topbar); padding: 0 var(--space-8);
    background: var(--surface-elevated);
    border-bottom: 1px solid var(--border-strong);
    flex-shrink: 0; position: relative; z-index: var(--layer-header);
  }
  .left { display: flex; align-items: center; gap: var(--space-10); min-width: 0; }
  .brand {
    display: inline-flex; align-items: center; gap: var(--space-5);
    color: var(--foreground); font-size: var(--text-sm); font-weight: var(--weight-bold);
    letter-spacing: .02em; text-decoration: none;
  }
  .brand:hover { text-decoration: underline; text-underline-offset: .2em; }
  .menus { display: flex; gap: 0; }
  .panel-menu { min-width: 0; }
  .menu {
    display: inline-flex; align-items: center; gap: var(--space-3);
    min-height: var(--height-control); padding: 0 var(--space-6);
    border: 1px solid transparent; border-radius: var(--radius-sm);
    background: transparent; color: var(--muted-foreground);
    font-size: var(--text-xs); cursor: pointer;
  }
  .panel-more { display: none; }
  .menu:hover, .menu.active { border-color: var(--border); background: var(--surface-muted); color: var(--foreground); }
  .menu:disabled { opacity: .45; cursor: wait; }
  .menu:disabled:hover { border-color: transparent; background: transparent; color: var(--muted-foreground); }
  .panel-toggle.active { color: var(--primary); box-shadow: inset 0 -2px var(--primary); }
  .panel-icon { display: none; }
  .center {
    display: flex; align-items: center; gap: var(--space-5);
    padding: 0 var(--space-6); min-height: var(--height-control-sm);
    border: 1px solid var(--border); border-radius: var(--radius-sm);
    background: var(--input); font-family: var(--font-mono); font-size: var(--text-xs);
  }
  .timecode { color: var(--foreground); font-variant-numeric: tabular-nums; }
  .timecode.dim, .center .sep { color: var(--muted-foreground); }
  .right { display: flex; align-items: center; gap: var(--space-8); flex: 0 0 auto; }
  .generate-scenes { display:inline-flex; align-items:center; gap:var(--space-3); min-height:34px; margin-right:var(--space-4); padding:0 var(--space-6); border:1px solid var(--border); border-radius:var(--radius-sm); background:var(--secondary); color:var(--foreground); font:var(--text-xs)/1.2 var(--font-sans); cursor:pointer; white-space:nowrap; }
  .generate-scenes svg { width:18px; height:18px; fill:none; stroke:currentColor; stroke-width:1.5; stroke-linejoin:round; }
  .generate-scenes:hover { background:var(--surface-muted); }
  .generate-scenes:focus-visible { outline:2px solid var(--ring); outline-offset:2px; }
  .command .generate-scenes { background:var(--command-control); color:var(--command-ink); border-color:var(--command-rule); }
  .command .generate-scenes:hover { background:var(--command-control-hover); }
  .command .generate-scenes:focus-visible { outline-color:var(--command-ink); }
  @media (max-width:1100px) { .generate-scenes span { display:none; } .generate-scenes { width:36px; justify-content:center; padding:0; } }
  .history { display: flex; gap: var(--space-2); }
  .history-btn {
    display: inline-flex; align-items: center; justify-content: center;
    width: var(--height-control); height: var(--height-control);
    padding: 0; border: 1px solid var(--border); border-radius: var(--radius-sm);
    color: var(--secondary-foreground); background: var(--secondary); cursor: pointer;
  }
  .history-btn:hover:not(:disabled) { border-color: var(--border-strong); background: var(--surface-muted); }
  .history-btn:disabled { opacity: .4; cursor: not-allowed; }
  .history-btn svg { width: var(--icon-sm); height: var(--icon-sm); fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
  .fps { font-size: var(--text-2xs); color: var(--muted-foreground); font-family: var(--font-mono); }
  .fps .num { color: var(--foreground); font-variant-numeric: tabular-nums; }

  .topbar.command { --command-bg: var(--background); --command-ink: var(--foreground); --command-muted: var(--muted-foreground); --command-rule: var(--border); --command-control: var(--surface); --command-control-hover: var(--surface-elevated); --command-time: var(--input); --command-accent: var(--primary); height: 54px; padding-inline: 18px; background: var(--command-bg); border-bottom-color: var(--command-rule); color: var(--command-ink); gap: 20px; }
  .command .left { gap: 17px; flex: 1 1 0; }
  .command .brand { color: var(--command-ink); font-size: 15px; font-weight: 700; letter-spacing: -.025em; }
  .workspace-name { padding-left: 16px; border-left: 1px solid var(--command-rule); color: var(--command-muted); font-size: 11px; font-weight: 500; white-space: nowrap; }
  .command .center { min-height: 34px; margin: 0; padding: 0 16px; border: 1px solid var(--command-rule); border-radius: 2px; background: var(--command-time); font-size: 12px; }
  .command .timecode { color: var(--command-ink); }
  .command .timecode.dim, .command .center .sep { color: var(--command-muted); }
  .command .right { flex: 1 1 0; justify-content: flex-end; gap: 0; }
  .command .right > :global(.document-button) { border-color: var(--command-rule); border-radius: 2px 0 0 2px; background: var(--command-control); color: var(--command-ink); }
  .command .right > :global(.document-button:hover) { background: var(--command-control-hover); }
  .command .history { gap: 0; margin-left: 10px; }
  .command .history-btn { border-color: var(--command-rule); border-radius: 0; background: var(--command-control); color: var(--command-ink); }
  .command .history-btn + .history-btn { border-left: 0; }
  .command .history-btn:hover:not(:disabled) { background: var(--command-control-hover); color: var(--command-ink); }
  .command .fps { margin-inline: 12px; padding-inline: 10px; border: 0; border-left: 1px solid var(--command-rule); border-radius: 0; background: none; color: var(--command-muted); }
  .command .fps .num { color: var(--command-ink); }
  .command .history-btn:focus-visible, .command .right > :global(.document-button:focus-visible) { outline: 2px solid var(--command-ink); outline-offset: 2px; }

  @media (min-width: 1025px) {
    .topbar { padding: 0 var(--space-10); }
    .left { gap: var(--space-12); }
    .brand { gap: var(--space-5); font-size: var(--text-md); }
    .menus {
      height: 100%; gap: 0; padding: 0;
      border-left: 1px solid var(--border); border-right: 1px solid var(--border);
      overflow-x: auto; scrollbar-width: none;
    }
    .menus::-webkit-scrollbar { display: none; }
    .menus .panel-toggle {
      position: relative; min-height: var(--height-topbar);
      flex: 0 0 auto;
      gap: var(--space-4); padding: 0 var(--space-8);
      border: 0; border-right: 1px solid var(--border); border-radius: 0;
      color: var(--muted-foreground); font-size: var(--text-2xs); font-weight: var(--weight-semibold);
      transition: color .15s ease, background .15s ease;
    }
    .menus .panel-toggle:hover {
      border-color: var(--border); background: var(--surface-muted); color: var(--foreground);
    }
    .menus .panel-toggle.active {
      border-color: var(--border); background: var(--primary-subtle); color: var(--primary);
      box-shadow: inset 0 -2px var(--primary);
    }
    .menus .panel-toggle.active::after {
      content: none;
    }
    .panel-icon {
      display: block;
      width: 15px; height: 15px;
      flex: 0 0 auto;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.45;
      stroke-linecap: round;
      stroke-linejoin: round;
      opacity: .82;
    }
    .menus .panel-toggle.active .panel-icon { color: var(--primary); opacity: 1; }
    .fps {
      padding: var(--space-3) var(--space-5);
      border: 1px solid var(--border); border-radius: var(--radius-sm);
      background: var(--surface); color: var(--muted-foreground);
    }
  }

  @media (min-width: 1025px) and (max-width: 1439px) {
    .left { flex: 0 0 auto; }
    .panel-menu { position: relative; }
    .panel-more {
      display: inline-flex;
      min-width: 128px;
      justify-content: space-between;
      border-color: var(--border);
      background: var(--surface);
      color: var(--foreground);
    }
    .panel-more:hover,
    .panel-more[aria-expanded='true'] {
      border-color: var(--primary-border);
      background: var(--primary-subtle);
      color: var(--primary);
    }
    .panel-more .chev {
      width: 12px;
      height: 12px;
      transition: transform 140ms ease;
    }
    .panel-more[aria-expanded='true'] .chev { transform: rotate(180deg); }
    .menus {
      display: none;
      position: absolute;
      top: calc(100% + var(--space-4));
      left: 0;
      z-index: var(--layer-popover);
      width: 340px;
      height: auto;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      padding: var(--space-4);
      border: 1px solid var(--border-strong);
      border-radius: var(--radius-md);
      background: var(--surface-elevated);
      box-shadow: var(--shadow-popover);
      overflow: visible;
    }
    .menus.open { display: grid; }
    .menus .panel-toggle {
      min-height: var(--height-control-lg);
      justify-content: flex-start;
      padding: 0 var(--space-6);
      border: 1px solid transparent;
      border-radius: var(--radius-sm);
      font-size: var(--text-xs);
    }
    .menus .panel-toggle.active {
      border-color: var(--primary-border);
      box-shadow: none;
    }
    .panel-icon { display: block; }
    .center { margin-inline: auto; }
  }

  @media (max-width: 1024px) {
    .topbar.command { height: 48px; padding-inline: 8px; gap: 6px; }
    .workspace-name { display: none; }
    .command .left { flex: 0 0 auto; }
    .command .right { flex: 0 0 auto; }
    .command .center { min-height: 32px; padding-inline: 6px; }
    .command .history { margin-left: 4px; }
    .topbar {
      height: var(--height-topbar);
      padding: 0 var(--space-3);
      gap: var(--space-2);
      padding-top: env(safe-area-inset-top);
    }
    .left { flex: 0 1 auto; min-width: 0; gap: var(--space-2); }
    .brand { font-size: var(--text-2xs); white-space: nowrap; }
    .brand { --brand-mark-size: 20px; }
    .center {
      display: flex;
      flex: 0 1 auto;
      min-width: 0;
      margin-inline: auto;
      padding: 0 var(--space-3);
      gap: var(--space-2);
      font-size: var(--text-2xs);
      overflow: hidden;
      white-space: nowrap;
    }
    .right { display: flex; flex: 0 0 auto; align-items: center; gap: var(--space-2); margin-left: 0; }
    .history { display: flex; gap: var(--space-2); }
    .history-btn { width: 36px; height: 36px; }
    .fps { display: none; }
    /* Panels moved to the bottom MobilePanelBar — hide the dropdown switcher */
    .panel-menu { display: none; }
  }

  @media (max-width: 380px) {
    .center { padding: 0 var(--space-2); }
    .history-btn { width: 34px; height: 34px; }
  }
  @media (max-width: 600px) {
    .topbar.command { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2px 6px; height: auto; min-height: 56px; padding-block: 4px; }
    .command .left { grid-area: 1 / 1; align-self: end; }
    .command .brand { gap: 6px; font-size: 13px; line-height: 1.2; }
    .command .center { grid-area: 2 / 1; align-self: start; justify-self: start; min-height: 20px; margin: 0; padding-inline: 4px; font-size: 10px; }
    .command .right { grid-area: 1 / 2 / span 2 / 3; align-self: center; }
    .command .right > :global(.document-button) { padding-inline: 8px; }
    .command .center .dim, .command .center .sep { display: none; }
  }

  @media (pointer: coarse) and (max-width: 1024px) {
    .generate-scenes { min-height:40px; width:40px; }
    .menu { min-height: 44px; }
    .history-btn { width: 44px; height: 44px; }
  }
</style>
