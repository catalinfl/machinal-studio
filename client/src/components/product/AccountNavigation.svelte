<script lang="ts">
  let { current }: { current: 'membership' | 'jobs' | 'keys' } = $props()
</script>

<nav aria-label="Account pages" class="account-navigation">
  <a href="/membership" aria-current={current === 'membership' ? 'page' : undefined}>Membership &amp; billing</a>
  <a href="/jobs" aria-current={current === 'jobs' ? 'page' : undefined}>Jobs &amp; downloads</a>
  <a href="/api-keys" aria-current={current === 'keys' ? 'page' : undefined}>API keys</a>
</nav>

<style>
  .account-navigation { display: flex; flex-wrap: wrap; gap: 8px 24px; margin-bottom: 30px; padding-bottom: 14px; border-bottom: 1px solid var(--home-rule); }
  a { display: inline-flex; align-items: center; min-height: 40px; color: var(--home-muted); font-size: 13px; text-underline-offset: 5px; text-decoration: none; }
  a:hover, a[aria-current='page'] { color: var(--home-accent); text-decoration: underline; }
  a:focus-visible { outline: 2px solid var(--home-accent); outline-offset: 4px; }
</style>
