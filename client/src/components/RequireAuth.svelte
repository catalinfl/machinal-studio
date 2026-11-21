<script lang="ts">
  import type { Snippet } from 'svelte'
  import { auth } from '../stores/auth.svelte'
  import { loginUrl, redirectToLogin } from '../lib/auth-navigation'

  let { children, target }: { children: Snippet; target: string } = $props()
  const destination = $derived(loginUrl(target))

  $effect(() => {
    if (!auth.isLogged) redirectToLogin(target)
  })
</script>

{#if auth.isLogged}
  {@render children()}
{:else}
  <main class="auth-forward" aria-live="polite"><p>Sign in to continue.</p><a href={destination}>Continue to login</a></main>
{/if}

<style>
  .auth-forward { padding: 40px; color: var(--foreground); }
  a { color: var(--primary); text-underline-offset: 4px; }
</style>
