<script lang="ts">
  import ClipLooksPalette from './ClipLooksPalette.svelte'
  import BrowserPanel from './BrowserPanel.svelte'
</script>

<BrowserPanel
  id="presets-panel"
  ariaLabel="Clip styles browser"
  title="Clip Styles"
  subtitle="Ready-made looks for your clips"
>
  <ClipLooksPalette />
</BrowserPanel>
