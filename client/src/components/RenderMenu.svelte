<script lang="ts">
  import { useRenderMenu } from '../composables/useRenderMenu.svelte'
  import type { AIFeature } from '../lib/ai-access'
  import CreditUsageNotice from './CreditUsageNotice.svelte'

  let { onRequireAccess }: { onRequireAccess?: (feature: AIFeature) => void } = $props()

  const renderMenu = useRenderMenu({ getOnRequireAccess: () => onRequireAccess })
</script>

<div class="render-menu">
  <button
    class="trigger"
     class:active={renderMenu.open}
     class:compiling={renderMenu.exportState.kind === 'compiling'}
     onclick={renderMenu.openDialog}
    aria-haspopup="dialog"
     aria-expanded={renderMenu.open}
  >
    <span class="render-icon" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M8 2v7.5m0-7.5L5.5 4.5M8 2l2.5 2.5M3 9.5V13h10V9.5" /></svg></span>
    {renderMenu.exportState.kind === 'compiling' ? 'Rendering…' : 'Render'}
    <svg class="chevron" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 4l4 4 4-4" /></svg>
  </button>

    {#if renderMenu.open}
    <dialog
      class="panel"
      bind:this={renderMenu.dialogEl}
      aria-labelledby="render-title"
      aria-describedby="render-subtitle"
      onclose={renderMenu.closeDialog}
      oncancel={(event) => event.preventDefault()}
    >
     <div class="dialog-shell">
      <header class="panel-head">
        <div>
          <h2 id="render-title">Render project</h2>
          <p id="render-subtitle" class="subtitle">Choose format, quality, and where to export.</p>
        </div>
        <button type="button" class="close" onclick={renderMenu.closeDialog} aria-label="Close render menu"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" /></svg></button>
      </header>

      <div class="dialog-body">
      <div class="settings">
        <span class="section-label">Output settings</span>
        <fieldset>
          <legend>Format</legend>
          <div class="option-grid format-grid">
          {#each renderMenu.formatOptions as option (option.value)}
              <button
                 type="button"
                 class:selected={renderMenu.outputFormat === option.value}
                 aria-pressed={renderMenu.outputFormat === option.value}
                 onclick={renderMenu.selectFormatOption(option.value)}
              >
                <strong>{option.label}</strong>
                <small>{option.detail}</small>
              </button>
            {/each}
          </div>
        </fieldset>
        <fieldset>
          <legend>Quality</legend>
          <div class="option-grid quality-grid">
          {#each renderMenu.qualityOptions as option (option.value)}
              <button
                 type="button"
                 class:selected={renderMenu.outputQuality === option.value}
                 aria-pressed={renderMenu.outputQuality === option.value}
                 onclick={renderMenu.selectQualityOption(option.value)}
              >
                <strong>{option.label}</strong>
                <small>{option.detail}</small>
              </button>
            {/each}
          </div>
        </fieldset>
        <div class="summary" role="status">
           {#if renderMenu.outputFormat === 'mp3'}
            Only active, unmuted audio tracks will be exported.
          {:else}
            Video settings follow the current project.
          {/if}
        </div>
      </div>

      <div class="destinations">
        <span class="section-label">Where to export</span>
        <button
          class="destination server"
          type="button"
          class:running={renderMenu.exportState.kind === 'compiling' && renderMenu.exportState.target === 'server'}
          onclick={renderMenu.exportThrough('server')}
          disabled={renderMenu.exportState.kind === 'compiling' || renderMenu.hasLocalMedia}
          title={renderMenu.hasLocalMedia
            ? 'Browser-only media must be rendered in this browser'
            : 'Render on the server'}
        >
          <span class="destination-icon" aria-hidden="true"><svg viewBox="0 0 16 16"><rect x="2.5" y="2.5" width="11" height="4.6" rx="1" /><rect x="2.5" y="8.9" width="11" height="4.6" rx="1" /><path d="M5 4.8h.01M5 11.2h.01" /></svg></span>
          <span class="destination-copy">
            <strong>Server <span class="paid-badge">Paid</span></strong>
            <small>{renderMenu.hasLocalMedia ? 'Unavailable: project has browser-only media' : 'Render on the server from uploaded media · uses credits'}</small>
          </span>
          <svg class="arrow" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8h9m0 0-4.2-4.2M12.5 8l-4.2 4.2" /></svg>
        </button>
        <button
          class="destination local"
          type="button"
          class:running={renderMenu.exportState.kind === 'compiling' && renderMenu.exportState.target === 'local'}
          onclick={renderMenu.exportThrough('local')}
          disabled={renderMenu.exportState.kind === 'compiling'}
          title="Render on this device"
        >
          <span class="destination-icon" aria-hidden="true"><svg viewBox="0 0 16 16"><rect x="2" y="2.8" width="12" height="8" rx="1" /><path d="M6 13.2h4M8 10.8v2.4" /></svg></span>
          <span class="destination-copy">
            <strong>Local</strong>
            <small>Render on this device with all media · no credits</small>
          </span>
          <svg class="arrow" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8h9m0 0-4.2-4.2M12.5 8l-4.2 4.2" /></svg>
        </button>
        <CreditUsageNotice />
      </div>

        {#if renderMenu.exportState.kind !== 'idle'}
          <div class="status {renderMenu.exportState.kind}">
            {#if renderMenu.exportState.kind === 'compiling'}<span class="spinner"></span>{/if}
            {#if renderMenu.exportState.kind === 'compiling' && renderMenu.exportState.progress}
              {@const percentage = Math.min(99, Math.floor(renderMenu.exportState.progress.ratio * 100))}
            <div class="status-progress">
              <div class="status-head">
                  <span class="status-message" role="status" aria-live="polite">{renderMenu.exportState.message}</span>
                <strong>{percentage}%</strong>
              </div>
              <div
                class="progress-track"
                role="progressbar"
                aria-label="Final render progress"
                aria-valuemin="0"
                aria-valuemax="100"
                aria-valuenow={percentage}
              >
                  <span style:transform={`scaleX(${renderMenu.exportState.progress.ratio})`}></span>
              </div>
              <div class="progress-time">
                  {#if renderMenu.exportState.progress.etaAvailable}
                    <span>~{renderMenu.formatRenderTime(renderMenu.exportState.progress.remainingSeconds)} remaining</span>
                  {:else}
                    <span>Time estimate unavailable</span>
                  {/if}
                  <span>{renderMenu.formatRenderTime(renderMenu.exportState.progress.elapsedSeconds)} elapsed</span>
              </div>
            </div>
            {:else if renderMenu.exportState.kind === 'error'}
              <span role="alert">{renderMenu.exportState.message}</span>
           {:else}
              <span role="status">{renderMenu.exportState.message}</span>
          {/if}
        </div>
      {/if}
      </div>
     </div>
    </dialog>
  {/if}
</div>

<style>
  .render-menu { position: relative; }
  .trigger {
    height: var(--height-control); display: inline-flex; align-items: center; gap: var(--space-4);
    padding: 0 var(--space-6) 0 var(--space-4); border: 1px solid var(--primary); border-radius: var(--radius-sm);
    background: var(--primary); color: var(--primary-foreground);
    font-size: var(--text-2xs); font-weight: var(--weight-bold); cursor: pointer;
    box-shadow: var(--shadow-object);
  }
  .trigger:hover, .trigger.active { border-color: var(--primary-hover); background: var(--primary-hover); }
  .trigger.compiling { border-color: var(--border); background: var(--secondary); color: var(--secondary-foreground); }
  .trigger svg.chevron { width: 10px; height: 10px; }
  .trigger svg.chevron path { fill: none; stroke: currentColor; stroke-width: 1.5; }
  .render-icon {
    width: 18px; height: 18px; display: grid; place-items: center;
    border-radius: var(--radius-xs); background: color-mix(in srgb, currentColor 18%, transparent);
  }
  .render-icon svg { width: 12px; height: 12px; }
  .render-icon svg path { fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
  .panel {
    width: min(680px, calc(100vw - 48px)); height: min(760px, calc(100dvh - 48px));
    box-sizing: border-box; margin: auto; padding: 0; overflow: hidden;
    border: 1px solid var(--border-strong); border-radius: var(--radius-lg);
    background: var(--surface-elevated); box-shadow: var(--shadow-dialog);
    color: var(--foreground); font-family: var(--font-sans);
    will-change:transform, opacity;
    animation: dialog-arrive 180ms cubic-bezier(.16, 1, .3, 1) both;
  }
  .panel::backdrop {
    background: var(--scrim);
    animation:scrim-fade 180ms ease-out both;
  }
  .dialog-shell { display: grid; grid-template-rows: auto minmax(0, 1fr); height: 100%; }
  .dialog-body {
    min-height: 0; overflow-x: hidden; overflow-y: auto;
    padding: var(--space-12) var(--space-20) var(--space-20);
    background: var(--surface-elevated);
    scrollbar-color: var(--border-strong) var(--surface);
  }
  .panel-head {
    min-height: 76px; display: flex; align-items: center; justify-content: space-between;
    gap: var(--space-8); margin: 0; padding: var(--space-8) var(--space-10);
    border-bottom: 1px solid var(--border); background: var(--surface-elevated);
  }
  .section-label {
    display: block; color: var(--muted-foreground); font-size: var(--text-2xs); font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-label); text-transform: uppercase;
  }
  h2 { margin: 0; font-size: var(--text-xl); font-weight: var(--weight-bold); letter-spacing: -.025em; line-height: var(--leading-tight); text-wrap: balance; }
  .subtitle { max-width: 58ch; margin: var(--space-2) 0 0; color: var(--muted-foreground); font-size: var(--text-xs); line-height: var(--leading-ui); }
  .close {
    width: var(--height-control); height: var(--height-control); flex: 0 0 auto; display: grid; place-items: center; padding: 0;
    border: 1px solid var(--border); border-radius: var(--radius-sm);
    background: var(--surface); color: var(--secondary-foreground); cursor: pointer;
    transition: border-color 140ms ease, background-color 140ms ease, color 140ms ease;
  }
  .close svg { width: 15px; height: 15px; }
  .close svg path { fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; }
  .close:hover { color: var(--primary); border-color: var(--primary-border); background: var(--primary-subtle); }
  .close:focus-visible { outline: none; border-color: var(--primary); box-shadow: var(--focus-ring); }
  .close:active { transform: translateY(1px); }
  .settings {
    display: grid; gap: var(--space-10);
    padding: var(--space-12); border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--surface);
  }
  fieldset { min-width: 0; margin: 0; padding: 0; border: 0; }
  legend {
    margin-bottom: var(--space-5); color: var(--muted-foreground);
    font-size: var(--text-2xs); font-weight: var(--weight-medium);
  }
  .option-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-5); }
  .option-grid button {
    display: flex; min-width: 0; min-height: 58px; flex-direction: column; justify-content: center; gap: 2px;
    padding: var(--space-6); border: 1px solid var(--border); border-radius: var(--radius-sm);
    background: var(--input); color: var(--foreground); text-align: left; cursor: pointer;
  }
  .option-grid button:hover { border-color: var(--primary-border); background: var(--primary-subtle); }
  .option-grid button:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
  .option-grid button:active { transform: translateY(1px); }
  .option-grid button.selected { border-color: var(--primary); background: var(--primary-subtle); }
  .option-grid strong { font-size: var(--text-xs); }
  .option-grid small { overflow: hidden; color: var(--muted-foreground); font-size: var(--text-2xs); text-overflow: ellipsis; white-space: nowrap; }
  .summary {
    min-height: 16px; color: var(--muted-foreground); font-size: var(--text-2xs);
  }
  .destinations { display: flex; flex-direction: column; gap: var(--space-6); margin-top: var(--space-12); }
  .destination {
    display: grid; grid-template-columns: 34px 1fr 18px; align-items: center; gap: var(--space-8);
    width: 100%; padding: var(--space-10); border: 1px solid var(--border); border-radius: var(--radius-md);
    background: var(--surface); color: var(--foreground); text-align: left; cursor: pointer;
    transition: border-color 140ms ease, background-color 140ms ease, color 140ms ease;
  }
  .destination:hover:not(:disabled) { border-color: var(--primary-border); background: var(--primary-subtle); }
  .destination:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
  .destination:active:not(:disabled) { transform: translateY(1px); }
  .destination:disabled { cursor: not-allowed; }
  .destination.server:disabled { background: var(--surface); }
  .destination.server:disabled .destination-icon { opacity: .6; }
  .destination.running { border-color: var(--primary); background: var(--primary-subtle); }
  .destination-icon {
    width: 32px; height: 32px; display: grid; place-items: center; border-radius: var(--radius-sm);
    background: var(--primary-subtle); color: var(--primary);
  }
  .destination-icon svg { width: 18px; height: 18px; }
  .destination-icon svg rect, .destination-icon svg path { fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
  .destination-copy { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
  .destination-copy strong { font-size: var(--text-xs); }
  .paid-badge {
    display: inline-block; vertical-align: 1px; margin-left: 4px; padding: 1px 6px;
    border: 1px solid var(--primary-border); border-radius: var(--radius-pill);
    background: var(--primary-subtle); color: var(--primary);
    font-size: 9px; font-weight: var(--weight-bold); letter-spacing: .04em; text-transform: uppercase;
  }
  .destination-copy small { color: var(--muted-foreground); font-size: var(--text-2xs); }
  .arrow { width: 14px; height: 14px; justify-self: end; color: var(--muted-foreground); transition: color .15s ease; }
  .arrow path { fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
  .destination:hover:not(:disabled) .arrow { color: var(--primary); }
  .status {
    display: flex; align-items: center; gap: var(--space-6); margin-top: var(--space-8); padding: var(--space-8);
    border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); color: var(--muted-foreground);
    font-size: var(--text-2xs); line-height: var(--leading-ui); overflow-wrap: anywhere;
  }
  .status.done { color: var(--success); background: var(--success-subtle); }
  .status.error { color: var(--destructive); background: var(--destructive-subtle); border-color: var(--destructive); }
  .spinner {
    width: 12px; height: 12px; flex: 0 0 auto; border: 2px solid var(--border);
    border-top-color: var(--primary); border-radius: var(--radius-pill); animation: spin .75s linear infinite;
  }
  .status-progress { display: flex; flex: 1; min-width: 0; flex-direction: column; gap: var(--space-5); }
  .status-head, .progress-time { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-8); }
  .status-message { min-width: 0; overflow: hidden; color: var(--foreground); text-overflow: ellipsis; white-space: nowrap; }
  .status-head strong { color: var(--primary); font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
  .progress-track { height: 4px; overflow: hidden; border-radius: var(--radius-pill); background: var(--secondary); }
  .progress-track span {
    display: block; width: 100%; height: 100%; border-radius: inherit; background: var(--primary);
    transform-origin: left center; transition: transform .2s ease-out;
  }
  .progress-time { flex-wrap: wrap; color: var(--muted-foreground); font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
  @keyframes spin { to { transform: rotate(360deg); } }

  @media (prefers-reduced-motion: reduce) {
    .panel { animation: none; }
    .spinner { animation-duration: 0.01ms; animation-iteration-count: 1; }
  }

  @media (max-width: 700px), (max-width: 900px) and (orientation: landscape) {
    .panel { width: 100vw; height: 100dvh; border: 0; border-radius: 0; }
    .panel-head { min-height: 68px; padding: var(--space-6); }
    .dialog-body { padding: var(--space-6); }
    .option-grid { grid-template-columns: 1fr; }
    .option-grid button { min-height: 48px; }
  }

  @media (pointer: coarse) {
    .close { width: 40px; height: 40px; }
  }
</style>
