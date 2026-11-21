<script lang="ts">
  import LandingIcon from '../home/LandingIcon.svelte'

  let { href, label, solid = false, icon = 'arrow', onclick }: {
    href: string
    label: string
    solid?: boolean
    icon?: 'arrow' | 'direction'
    onclick?: (event: MouseEvent) => void
  } = $props()
</script>

<a class="button product-action" class:button-solid={solid} {href} {onclick}>
  <span>{label}</span><LandingIcon name={icon} size={16} />
</a>

<style>
  .product-action { gap: 14px; text-rendering: auto; }
  .product-action > span { color: inherit; }
  .product-action :global(svg) { flex-shrink: 0; color: inherit; }
  .product-action.button-solid, .product-action.button-solid:hover { color: #262a30; }
</style>
