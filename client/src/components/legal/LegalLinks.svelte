<script lang="ts">
  import { privacyNotice } from '../../stores/privacy.svelte'
</script>

<nav class="legal-links" aria-label="Legal and privacy">
  <a href="/about">About</a>
  <a href="/privacy">Privacy</a>
  <a href="/terms">Terms</a>
  <button type="button" onclick={privacyNotice.open}>Cookies &amp; storage</button>
</nav>

<style>
  .legal-links { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 20px; }
  a, button { display: inline-flex; align-items: center; min-height: 44px; padding: 0; border: 0; background: transparent; color: var(--home-muted, var(--muted-foreground)); font: 400 12px var(--font-sans); text-decoration: none; cursor: pointer; }
  a:hover, button:hover { color: var(--home-accent, var(--primary)); text-decoration: underline; text-underline-offset: 4px; }
  a:focus-visible, button:focus-visible { outline: 2px solid var(--ring); outline-offset: 3px; }
</style>
