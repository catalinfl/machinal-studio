<script lang="ts">
  import '../home/home.css'
  import './product.css'
  import type { Snippet } from 'svelte'
  import SiteFooter from './SiteFooter.svelte'

  let { children }: { children: Snippet } = $props()
</script>

<main class="home product-page">
  <div class="product-content">{@render children()}</div>
  <SiteFooter />
</main>
