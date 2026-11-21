<script lang="ts">
  import { Link } from 'svelte-wayfind'
</script>

<main class="notfound">
  <div class="code">404</div>
  <p>The page you requested could not be found.</p>
  <p><Link to="/" class="home-link">← Go home</Link></p>
</main>

<style>
  .notfound {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-8);
    padding: var(--space-20);
    overflow-y: auto;
    text-align: center;
  }
  .code {
    padding: 0 var(--space-16) var(--space-8);
    border-bottom: 1px solid var(--primary);
    color: var(--foreground);
    font-family: var(--font-mono);
    font-size: clamp(3rem, 10vw, 5rem);
    font-weight: var(--weight-semibold);
    letter-spacing: -.04em;
    line-height: 1;
  }
  p { max-width: 42ch; margin: 0; color: var(--muted-foreground); }
  :global(a.home-link) { color: var(--primary); font-weight: var(--weight-medium); text-underline-offset: 3px; }
  :global(a.home-link:hover) { color: var(--primary-hover); }
</style>
