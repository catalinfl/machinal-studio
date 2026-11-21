<script lang="ts">
  interface Props {
    showMediaBin?: boolean
    showEffects?: boolean
    showPresets?: boolean
    showTransitions?: boolean
    showText?: boolean
    showSpeech?: boolean
    showImage?: boolean
    showAI?: boolean
    mediaBusy?: boolean
    onToggleMediaBin?: () => void
    onToggleEffects?: () => void
    onTogglePresets?: () => void
    onToggleTransitions?: () => void
    onToggleText?: () => void
    onToggleSpeech?: () => void
    onToggleImage?: () => void
    onToggleAI?: () => void
  }

  let {
    showMediaBin = false,
    showEffects = false,
    showPresets = false,
    showTransitions = false,
    showText = false,
    showSpeech = false,
    showImage = false,
    showAI = false,
    mediaBusy = false,
    onToggleMediaBin,
    onToggleEffects,
    onTogglePresets,
    onToggleTransitions,
    onToggleText,
    onToggleSpeech,
    onToggleImage,
    onToggleAI,
  }: Props = $props()

  const tabs = $derived([
    { id: 'media-bin-panel', label: 'Media Bin', short: 'Media', active: showMediaBin, action: onToggleMediaBin, disabled: mediaBusy, icon: '<rect x="2.5" y="3" width="15" height="14" rx="2"/><path d="M2.5 7h15M7 7v10"/>' },
    { id: 'text-panel', label: 'Text', short: 'Text', active: showText, action: onToggleText, disabled: false, icon: '<path d="M4 4h12M10 4v12M7 16h6"/>' },
    { id: 'effects-panel', label: 'Effects', short: 'Effects', active: showEffects, action: onToggleEffects, disabled: false, icon: '<path d="M10 2.5l1.3 4.2L15.5 8l-4.2 1.3L10 13.5 8.7 9.3 4.5 8l4.2-1.3L10 2.5z"/>' },
    { id: 'presets-panel', label: 'Styles', short: 'Styles', active: showPresets, action: onTogglePresets, disabled: false, icon: '<rect x="3" y="3" width="11" height="11" rx="2"/><path d="M7 17h8a2 2 0 002-2V7"/>' },
    { id: 'text-to-speech-panel', label: 'Text to Speech', short: 'Speech', active: showSpeech, action: onToggleSpeech, disabled: false, icon: '<path d="M3 7.5v5M6 5v10M9 8.5v3M12 6.5v7M15 4v12M18 8v4"/>' },
    { id: 'transitions-panel', label: 'Transitions', short: 'Trans.', active: showTransitions, action: onToggleTransitions, disabled: false, icon: '<path d="M3 6h11M11 3l3 3-3 3M17 14H6M9 11l-3 3 3 3"/>' },
    { id: 'image-panel', label: 'Image', short: 'Image', active: showImage, action: onToggleImage, disabled: false, icon: '<rect x="2.5" y="3" width="15" height="14" rx="2"/><path d="m4.5 14 3.8-4 2.5 2.4 1.8-1.8 2.9 3.4M13.5 7h.01"/>' },
    { id: 'ai-panel', label: 'AI Edit', short: 'AI', active: showAI, action: onToggleAI, disabled: false, icon: '<path d="M10 2.5 11.4 7l4.6 1.4-4.6 1.4L10 14.5 8.6 9.8 4 8.4 8.6 7 10 2.5Z"/>' },
  ])
</script>

<nav class="mobile-panels" aria-label="Editor panels">
  <div class="mobile-panels-scroll">
    {#each tabs as t}
      <button
        type="button"
        class="ptab"
        class:active={t.active}
        aria-pressed={t.active}
        aria-controls={t.id}
        aria-label={t.label}
        title={t.label}
        disabled={t.disabled}
        onclick={t.action}
      >
        <svg viewBox="0 0 20 20" aria-hidden="true">{@html t.icon}</svg>
        <span>{t.short}</span>
      </button>
    {/each}
  </div>
</nav>

<style>
  .mobile-panels {
    display: none;
  }

  @media (max-width: 1024px) {
    .mobile-panels {
      display: block;
      flex: 0 0 auto;
      border-top: 1px solid var(--border-strong);
      background: var(--surface-elevated);
      padding-bottom: env(safe-area-inset-bottom);
      position: relative;
      z-index: var(--layer-header);
    }
    .mobile-panels-scroll {
      display: flex;
      gap: 2px;
      overflow-x: auto;
      overflow-y: hidden;
      padding: 6px 8px;
      scrollbar-width: none;
      -webkit-overflow-scrolling: touch;
    }
    .mobile-panels-scroll::-webkit-scrollbar {
      display: none;
    }
    .ptab {
      flex: 1 0 auto;
      min-width: 60px;
      min-height: 52px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 3px;
      padding: 6px 8px;
      border: 1px solid transparent;
      border-radius: var(--radius-md);
      background: transparent;
      color: var(--muted-foreground);
      font-size: 10px;
      font-weight: var(--weight-semibold);
      line-height: 1;
      cursor: pointer;
      white-space: nowrap;
    }
    .ptab svg {
      width: 20px;
      height: 20px;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.5;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .ptab:hover:not(:disabled):not(.active) {
      background: var(--surface-muted);
      color: var(--foreground);
    }
    .ptab.active {
      background: var(--primary-subtle);
      color: var(--primary);
      border-color: var(--primary-border);
    }
    .ptab:disabled {
      opacity: 0.45;
      cursor: wait;
    }
    .ptab:focus-visible {
      outline: 2px solid var(--ring);
      outline-offset: 1px;
    }
  }

  @media (pointer: coarse) and (max-width: 1024px) {
    .ptab {
      min-width: 64px;
      min-height: 56px;
    }
  }
</style>
