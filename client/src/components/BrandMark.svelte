<script lang="ts">
  let { size = 36 }: { size?: number } = $props()
</script>

<img class="brand-mark" src="/machinal-icon.svg" alt="" aria-hidden="true" width={size} height={size} style:--mark-size={`${size}px`} draggable="false" />

<style>
  .brand-mark { display: block; flex: 0 0 auto; width: var(--brand-mark-size, var(--mark-size)); height: var(--brand-mark-size, var(--mark-size)); }
</style>
