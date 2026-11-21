<script lang="ts">
  import { useTextPanel } from '../composables/useTextPanel.svelte'
  import { CAPTION_LANGUAGES } from '../stores/captions.svelte'
  import BrowserPanel from './BrowserPanel.svelte'
  import UiSelect from './UiSelect.svelte'

  const textPanel = useTextPanel()
  let { onGenerateCaptions = textPanel.generateSubtitlesEvent }: { onGenerateCaptions?: () => void } = $props()
</script>

<BrowserPanel id="text-panel" ariaLabel="Text browser" title="Text" subtitle="Titles and captions above the video">
  <section class="auto-captions" aria-labelledby="auto-captions-title">
    <div class="auto-captions-copy">
      <strong id="auto-captions-title">Voice to text captions</strong>
      <small>Turn speech from selected timeline clips into short, synced captions.</small>
    </div>
    <div class="caption-language">
      <label for="caption-language">Spoken language</label>
      <UiSelect
        id="caption-language"
        label="Spoken language for captions"
        value={textPanel.captionLanguage}
        options={CAPTION_LANGUAGES.map((option) => ({
          value: option.code,
          label: option.code === 'auto' ? option.label : `${option.label} (${option.code})`,
        }))}
        disabled={textPanel.generatingSubtitles}
        searchable
        searchPlaceholder="Search languages..."
        onChange={textPanel.setCaptionLanguage}
      />
    </div>
    <div class="caption-actions">
      <button class="generate-captions" onclick={onGenerateCaptions} disabled={textPanel.generatingSubtitles}>
        {textPanel.generatingSubtitles ? 'Transcribing speech...' : 'Generate voice to text'}
      </button>
      {#if textPanel.generatedCaptions.length > 0 || textPanel.selectedItems.length > 0 || textPanel.hasPendingCaptionReview || textPanel.hasTranscript}
        <button class="edit-captions" onclick={textPanel.editGeneratedCaptions}>
          {textPanel.editButtonLabel}
        </button>
      {/if}
    </div>
    {#if textPanel.subtitleError}
      <small class="caption-message error" role="alert">{textPanel.subtitleError}</small>
    {:else if textPanel.subtitleStatus}
      <small class="caption-message success" aria-live="polite">{textPanel.subtitleStatus}</small>
    {/if}
  </section>
  <div class="browser">
    <div class="preset-group">
      <div class="group-heading"><strong>Short-form essentials</strong><small>Hooks, readable captions and creator-style callouts</small></div>
      {#each textPanel.shortFormPresets as preset (preset.id)}
        <button class="preset short-form-preset" data-preset-id={preset.id} draggable="true" ondragstart={textPanel.dragShortFormText} onclick={textPanel.addShortFormText} title="Click to add at the playhead or drag onto the timeline">
          <span class="sample sample-{preset.variant} motion-{preset.values.animation}" style={textPanel.sampleStyle(preset.values)} aria-hidden="true">
            <span class="sample-text"><strong>{preset.previewTitle}</strong>{#if preset.previewSubtitle}<small>{preset.previewSubtitle}</small>{/if}</span>
          </span>
          <span class="copy"><strong>{preset.label}</strong><small>{preset.description}</small></span>
          <span class="add" aria-hidden="true"></span>
        </button>
      {/each}
    </div>
    <div class="preset-group">
      <div class="group-heading"><strong>Animated banners</strong><small>Ready-made lower thirds with color and motion</small></div>
      {#each textPanel.bannerPresets as preset (preset.label)}
        <button class="preset banner-preset" data-preset-label={preset.label} draggable="true" ondragstart={textPanel.dragBannerText} onclick={textPanel.addBannerText} title="Click to add at the playhead or drag onto the timeline">
          <span class="sample sample-{preset.variant} motion-{preset.values.animation}" style={textPanel.sampleStyle(preset.values)} aria-hidden="true"><span class="sample-text"><strong>{preset.previewTitle}</strong><small>{preset.previewSubtitle}</small></span></span>
          <span class="copy"><strong>{preset.label}</strong><small>{preset.description}</small></span>
          <span class="add" aria-hidden="true"></span>
        </button>
      {/each}
    </div>
    <div class="preset-group">
      <div class="group-heading"><strong>Titles and captions</strong><small>Static text styles for every part of the edit</small></div>
      {#each textPanel.presets as preset (preset.label)}
        <button class="preset" data-preset-label={preset.label} draggable="true" ondragstart={textPanel.dragPanelText} onclick={textPanel.addPanelText} title="Click to add at the playhead or drag onto the timeline">
          <span class="sample sample-{preset.variant}" style={textPanel.sampleStyle(preset.values)} aria-hidden="true"><span class="sample-text">{preset.label === 'Lower third' ? 'Aa' : preset.label}</span></span>
          <span class="copy"><strong>{preset.label}</strong><small>{preset.description}</small></span>
          <span class="add" aria-hidden="true"></span>
        </button>
      {/each}
    </div>
  </div>
</BrowserPanel>

<style>
   .auto-captions { display:flex; flex-direction:column; gap:var(--space-5); margin:0; padding:14px 16px; border:0; border-bottom:1px solid var(--border); border-radius:0; background:var(--surface-elevated); }
  .auto-captions-copy { display:flex; flex-direction:column; gap:3px; }
   .auto-captions-copy strong { color:var(--foreground); font-size:var(--text-sm); letter-spacing:-.02em; }
  .auto-captions-copy small, .caption-message { color:var(--muted-foreground); font-size:var(--text-2xs); line-height:1.35; }
  .caption-language { display:flex; flex-direction:column; gap:var(--space-3); min-width:0; color:var(--foreground); font-size:var(--text-xs); font-weight:var(--weight-semibold); }
   .caption-actions { display:flex; flex-wrap:wrap; gap:var(--space-3); }
  .generate-captions { min-height:34px; padding:0 var(--space-5); border:1px solid var(--primary-border); border-radius:var(--radius-sm); background:var(--primary); color:var(--primary-foreground); font-size:var(--text-xs); font-weight:var(--weight-bold); cursor:pointer; transition:filter 140ms ease, opacity 140ms ease; }
  .generate-captions:hover:not(:disabled) { filter:brightness(1.08); }
  .generate-captions:focus-visible { outline:2px solid var(--ring); outline-offset:2px; }
  .generate-captions:disabled { cursor:wait; opacity:.62; }
  .edit-captions { min-height:32px; padding:0 var(--space-5); border:1px solid var(--border); border-radius:var(--radius-sm); background:var(--secondary); color:var(--secondary-foreground); font-size:var(--text-xs); font-weight:var(--weight-semibold); cursor:pointer; }
  .edit-captions:hover:not(:disabled) { border-color:var(--border-strong); background:var(--surface-muted); }
  .edit-captions:focus-visible { outline:2px solid var(--ring); outline-offset:2px; }
  .caption-message.error { color:var(--destructive); }
  .caption-message.success { color:var(--foreground); }
   .browser { display:flex; flex-direction:column; gap:0; padding:0; }
   .preset-group { display:flex; flex-direction:column; gap:1px; padding:0 0 12px; background:var(--border); }
   .group-heading { display:flex; flex-direction:column; gap:2px; padding:18px 16px 10px; border-bottom:1px solid var(--border); background:var(--surface); }
   .group-heading strong { color:var(--foreground); font-size:var(--text-xs); }
  .group-heading small { color:var(--muted-foreground); font-size:var(--text-2xs); line-height:1.3; }
   .preset { display:grid; grid-template-columns:104px minmax(0, 1fr) 20px; align-items:center; gap:10px; min-height:78px; padding:8px 12px; border:1px solid transparent; border-radius:0; background:var(--surface-elevated); color:var(--foreground); text-align:left; cursor:grab; transition:border-color 140ms ease, background-color 140ms ease; }
  .preset:hover { border-color:var(--primary-border); background:var(--primary-subtle); }
  .preset:focus-visible { outline:2px solid var(--ring); outline-offset:2px; }
  .preset:active { cursor:grabbing; }
   .sample { position:relative; display:flex; align-items:center; justify-content:center; aspect-ratio:16 / 9; min-height:58px; overflow:hidden; isolation:isolate; border:1px solid color-mix(in srgb, var(--foreground) 16%, transparent); border-radius:0; background:var(--surface); color:var(--foreground); }
  .sample::before { content:''; position:absolute; inset:5px; z-index:0; border:1px solid color-mix(in srgb, var(--foreground) 12%, transparent); border-radius:var(--radius-xs); }
  .sample::after { content:''; position:absolute; right:7px; bottom:6px; left:7px; z-index:0; height:1px; background:color-mix(in srgb, var(--primary) 58%, transparent); }
  .sample-text { position:relative; z-index:1; display:block; max-width:100%; overflow:hidden; color:inherit; font-size:13px; font-weight:var(--weight-bold); line-height:1; white-space:nowrap; text-overflow:ellipsis; }
  .sample-title .sample-text { letter-spacing:-.04em; }
  .sample-title::after { right:auto; left:50%; width:24px; transform:translateX(-50%); }
  .sample-subtitle { align-items:flex-end; }
  .sample-subtitle .sample-text { margin-bottom:7px; font-size:9px; font-weight:var(--weight-medium); }
  .sample-subtitle::after { background:var(--border-strong); }
  .sample-lower-third { align-items:flex-end; justify-content:flex-start; }
  .sample-lower-third .sample-text { width:100%; margin:0 7px 7px; padding-left:7px; border-left:1px solid var(--primary); font-size:12px; text-align:left; }
  .sample-lower-third::after { right:auto; left:7px; width:18px; }
  .sample-banner-rail, .sample-banner-block, .sample-banner-underline { align-items:flex-end; justify-content:flex-start; background:#10141b; }
  .sample-banner-rail::after, .sample-banner-block::after, .sample-banner-underline::after { display:none; }
  .sample-banner-rail .sample-text, .sample-banner-block .sample-text, .sample-banner-underline .sample-text { width:82%; margin:0 0 7px 7px; padding:5px 7px; overflow:visible; border-radius:2px; background:var(--banner-bg); color:inherit; font-size:7px; line-height:1.05; text-align:left; white-space:normal; }
  .sample-banner-rail .sample-text { padding-left:11px; }
  .sample-banner-block .sample-text { padding-left:17px; }
  .sample-banner-underline .sample-text { padding-bottom:8px; }
  .sample-banner-rail .sample-text::before, .sample-banner-block .sample-text::before { content:''; position:absolute; inset:0 auto 0 0; width:4px; background:var(--banner-accent); }
  .sample-banner-block .sample-text::before { width:11px; }
  .sample-banner-underline .sample-text::after { content:''; position:absolute; right:0; bottom:0; left:0; height:3px; background:var(--banner-accent); }
  .sample-banner-rail .sample-text strong, .sample-banner-block .sample-text strong, .sample-banner-underline .sample-text strong { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .sample-banner-rail .sample-text small, .sample-banner-block .sample-text small, .sample-banner-underline .sample-text small { display:block; margin-top:2px; color:inherit; font-size:6px; font-weight:var(--weight-regular); opacity:.78; }
  .short-form-preset .sample { background:#101116; color:#fff; }
  .short-form-preset .sample::after { display:none; }
  .short-form-preset .sample-text { overflow:visible; white-space:normal; }
  .short-form-preset .sample-text strong, .short-form-preset .sample-text small { display:block; }
  .sample-hook-pop { align-items:flex-start; }
  .sample-hook-pop .sample-text { width:76%; margin-top:9px; font-size:11px; line-height:.92; text-align:center; text-shadow:0 1px 0 #000, 1px 0 0 #000, -1px 0 0 #000; }
  .sample-active-word { align-items:flex-end; }
  .sample-active-word .sample-text { margin:0 6px 7px; padding:4px 6px; border-radius:3px; background:#111; font-size:7px; line-height:1.05; text-align:center; }
   .sample-active-word .sample-text small { margin-top:2px; color:#f4ea58; font-size:8px; }
  .sample-clean-phrase { align-items:flex-end; }
  .sample-clean-phrase .sample-text { margin:0 6px 7px; padding:4px 6px; border-radius:3px; background:#09090a; font-size:8px; }
  .sample-keyword-punch .sample-text { padding:5px 7px; border-radius:2px; background:#f4ea58; color:#121318; font-size:10px; transform:rotate(-2deg); }
  .sample-step-label { align-items:flex-start; justify-content:flex-start; }
  .sample-step-label .sample-text { margin:7px; padding:4px 7px; background:#f4ea58; color:#15171b; font-size:7px; line-height:1.05; text-align:left; }
  .sample-step-label .sample-text small { margin-top:2px; font-size:6px; }
  .sample-reply-card { align-items:flex-start; justify-content:flex-start; }
  .sample-reply-card .sample-text { width:74%; margin:7px; padding:5px 7px; border-radius:5px; background:#fff; color:#17191d; font-size:6px; line-height:1.15; text-align:left; }
  .sample-reply-card .sample-text small { margin-top:3px; font-size:6px; font-weight:var(--weight-regular); }
  .sample-caption-bounce, .sample-clean-outline, .sample-color-block, .sample-payoff-line, .sample-side-snap { align-items:flex-end; }
  .sample-caption-bounce .sample-text, .sample-color-block .sample-text, .sample-payoff-line .sample-text { margin:0 6px 7px; padding:4px 6px; border-radius:3px; font-size:7px; line-height:1.05; text-align:center; }
  .sample-caption-bounce .sample-text { background:#17131f; }
  .sample-caption-bounce .sample-text small, .sample-payoff-line .sample-text small { margin-top:2px; color:#b18cff; font-size:8px; }
  .sample-top-drop, .sample-question-hook { align-items:flex-start; }
  .sample-top-drop .sample-text, .sample-question-hook .sample-text { width:78%; margin-top:8px; font-size:10px; line-height:.94; text-align:center; text-shadow:0 1px 0 #000, 1px 0 0 #000, -1px 0 0 #000; }
  .sample-question-hook .sample-text { color:#f4ea58; }
  .sample-side-snap { justify-content:flex-start; }
  .sample-side-snap .sample-text { width:68%; margin:0 0 7px 7px; padding:4px 6px; border-radius:2px; background:#fff; color:#17191d; font-size:7px; line-height:1.05; text-align:left; }
  .sample-beat-shake .sample-text { font-size:13px; text-shadow:0 1px 0 #000, 1px 0 0 #000, -1px 0 0 #000; }
  .sample-gentle-float .sample-text, .sample-quote-pull .sample-text { max-width:82%; padding:5px 7px; background:#17131f; font-family:Georgia, serif; font-size:8px; font-style:italic; line-height:1.05; text-align:center; }
  .sample-numeric-proof .sample-text { padding:5px 8px; border-radius:2px; background:#b18cff; color:#17121f; font-size:12px; }
  .sample-clean-outline .sample-text { margin-bottom:8px; font-size:9px; text-shadow:0 1px 0 #000, 1px 0 0 #000, -1px 0 0 #000; }
  .sample-color-block .sample-text { background:#7047c7; }
  .sample-color-block .sample-text small { margin-top:2px; color:#f4ea58; font-size:8px; }
  .sample-creator-tag { align-items:flex-start; justify-content:flex-start; }
  .sample-creator-tag .sample-text { margin:7px; padding:4px 6px; border-radius:2px; background:#fff; color:#17191d; font-size:6px; line-height:1.05; text-align:left; }
  .sample-creator-tag .sample-text small { margin-top:2px; font-size:5px; }
  .sample-payoff-line .sample-text { background:#0b0b0c; }
  .sample-tiktok-pop, .sample-tiktok-box, .sample-tiktok-glow { align-items:flex-end; }
  .sample-tiktok-pop .sample-text, .sample-tiktok-box .sample-text, .sample-tiktok-glow .sample-text { margin:0 6px 7px; padding:4px 6px; border-radius:3px; font-size:8px; font-weight:800; line-height:1.05; text-align:center; text-shadow:0 2px 0 #000, 2px 0 0 #000, -2px 0 0 #000, 0 -1px 0 #000; }
   .sample-tiktok-pop .sample-text small { margin-top:2px; color:#f4ea58; font-size:9px; }
   .sample-tiktok-box .sample-text small { margin-top:2px; padding:1px 5px; border-radius:3px; color:#fff; background:#f4ea58; font-size:9px; }
   .sample-tiktok-glow .sample-text small { margin-top:2px; color:#7df9ff; font-size:9px; text-shadow:0 0 8px #7df9ff; }
  .banner-preset:hover .motion-slide-left .sample-text, .banner-preset:focus-visible .motion-slide-left .sample-text { animation:sample-slide-left 520ms cubic-bezier(.16,1,.3,1); }
  .banner-preset:hover .motion-slide-right .sample-text, .banner-preset:focus-visible .motion-slide-right .sample-text { animation:sample-slide-right 520ms cubic-bezier(.16,1,.3,1); }
  .short-form-preset:hover .motion-rise .sample-text, .short-form-preset:focus-visible .motion-rise .sample-text { animation:sample-rise 360ms cubic-bezier(.16,1,.3,1); }
  .short-form-preset:hover .motion-pop .sample-text, .short-form-preset:focus-visible .motion-pop .sample-text { animation:sample-pop 360ms cubic-bezier(.16,1,.3,1); }
  .short-form-preset:hover .motion-drop .sample-text, .short-form-preset:focus-visible .motion-drop .sample-text { animation:sample-drop 380ms cubic-bezier(.16,1,.3,1); }
  .short-form-preset:hover .motion-bounce .sample-text, .short-form-preset:focus-visible .motion-bounce .sample-text { animation:sample-rebound 440ms cubic-bezier(.16,1,.3,1); }
  .short-form-preset:hover .motion-shake .sample-text, .short-form-preset:focus-visible .motion-shake .sample-text { animation:sample-shake 380ms ease-out; }
  .short-form-preset:hover .motion-float .sample-text, .short-form-preset:focus-visible .motion-float .sample-text { animation:sample-float 760ms ease-in-out; }
  .short-form-preset:hover .motion-slide-left .sample-text, .short-form-preset:focus-visible .motion-slide-left .sample-text { animation:sample-slide-left 420ms cubic-bezier(.16,1,.3,1); }
  .short-form-preset:hover .motion-slide-right .sample-text, .short-form-preset:focus-visible .motion-slide-right .sample-text { animation:sample-slide-right 420ms cubic-bezier(.16,1,.3,1); }
  @keyframes sample-slide-left { from { transform:translateX(-115%); } to { transform:translateX(0); } }
  @keyframes sample-slide-right { from { transform:translateX(115%); } to { transform:translateX(0); } }
  @keyframes sample-rise { from { transform:translateY(18px); } to { transform:translateY(0); } }
  @keyframes sample-pop { from { transform:translateY(14px); } to { transform:translateY(0); } }
  @keyframes sample-drop { from { transform:translateY(-18px); } to { transform:translateY(0); } }
  @keyframes sample-rebound { 0% { transform:translateY(15px); } 58% { transform:translateY(-3px); } 78% { transform:translateY(1px); } 100% { transform:translateY(0); } }
  @keyframes sample-shake { 0%, 100% { transform:translateX(0); } 18% { transform:translateX(-6px); } 38% { transform:translateX(5px); } 58% { transform:translateX(-3px); } 78% { transform:translateX(2px); } }
  @keyframes sample-float { from { transform:translateY(4px); } to { transform:translateY(-4px); } }
  .sample-caption .sample-text { padding:4px 6px; border-radius:var(--radius-xs); color:var(--surface) !important; background:var(--foreground); font-size:10px; letter-spacing:.04em; text-transform:uppercase; }
  .sample-social-hook { align-items:flex-start; justify-content:flex-start; }
  .sample-social-hook .sample-text { width:68%; margin:10px 7px; overflow:visible; color:var(--primary) !important; white-space:normal; font-size:12px; letter-spacing:-.04em; line-height:.9; text-align:left; }
  .sample-social-hook::after { right:auto; left:7px; width:24px; }
  .sample-quote .sample-text { max-width:82%; font-size:12px; font-weight:var(--weight-regular); line-height:1.05; text-align:center; }
  .sample-quote::after { background:var(--border-strong); }
  .sample-breaking-news { align-items:flex-end; justify-content:flex-start; }
  .sample-breaking-news::after { right:0; bottom:0; left:0; height:20px; background:var(--destructive); opacity:.9; }
  .sample-breaking-news .sample-text { width:100%; padding:0 7px 5px; color:var(--destructive-foreground) !important; font-size:7px; letter-spacing:.02em; text-align:left; text-transform:uppercase; }
  .sample-callout { align-items:flex-start; justify-content:flex-end; }
  .sample-callout .sample-text { margin:7px; padding:4px 6px; border-radius:var(--radius-xs); color:var(--primary-foreground) !important; background:var(--primary); font-size:9px; transform:rotate(-2deg); }
  .sample-callout::after { right:auto; left:7px; width:18px; }
  .sample-credits .sample-text { max-width:78%; overflow:visible; white-space:normal; font-size:8px; font-weight:var(--weight-medium); letter-spacing:.12em; line-height:1.15; text-align:center; text-transform:uppercase; }
  .sample-credits::after { right:auto; left:50%; width:20px; transform:translateX(-50%); }
  .sample-watermark { align-items:flex-end; justify-content:flex-end; }
  .sample-watermark .sample-text { margin:0 7px 7px; font-size:8px; font-weight:var(--weight-medium); opacity:.72; }
  .sample-watermark::after { background:var(--border-strong); }
  .copy { min-width:0; display:flex; flex-direction:column; gap:3px; }
  .copy strong { font-size:var(--text-xs); }
  .copy small { color:var(--muted-foreground); font-size:var(--text-2xs); line-height:1.25; }
   .add { position:relative; width:20px; height:20px; border:1px solid transparent; border-radius:2px; color:var(--primary); }
  .add::before, .add::after { content:''; position:absolute; top:50%; left:50%; width:10px; height:1px; background:currentColor; transform:translate(-50%, -50%); }
  .add::after { transform:translate(-50%, -50%) rotate(90deg); }
  .preset:hover .add { border-color:var(--primary-border); background:color-mix(in srgb, var(--primary) 12%, transparent); }
  @media (prefers-reduced-motion: reduce) {
    .banner-preset:hover .sample-text, .banner-preset:focus-visible .sample-text,
    .short-form-preset:hover .sample-text, .short-form-preset:focus-visible .sample-text { animation:none; }
  }
</style>
