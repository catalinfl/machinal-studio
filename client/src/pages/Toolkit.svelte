<script lang="ts">
  import ProductShell from '../components/product/ProductShell.svelte'
  import ToolkitLibrary from '../components/product/ToolkitLibrary.svelte'
  import DirectionDemo from '../components/DirectionDemo.svelte'
  import LandingIcon from '../components/home/LandingIcon.svelte'

  const target = `/toolkit${window.location.search}${window.location.hash}`
</script>

<svelte:head><title>The toolkit | machinal</title><meta name="description" content="Explore machinal styles, effects, transitions, motion and text presets. Search the real catalog, inspect controls and copy reusable YAML." /></svelte:head>

  <ProductShell>
    <div class="page-intro"><h1>The toolkit.<br /><span>Find your direction.</span></h1><p>Explore the styles, effects, transitions, motion and text already built into machinal. Find a preset, understand its controls, and carry it into your next edit or reusable recipe.</p></div>
    <ToolkitLibrary />
    <section class="toolkit-playground" aria-labelledby="toolkit-playground-heading"><div class="playground-heading"><div><h2 class="section-heading" id="toolkit-playground-heading">A few tools.<br />A different point of view.</h2><p>Try a selection of existing presets in an isolated timeline. Add scenes, style a clip, connect a transition and edit a title. Your editor project stays in its own workspace.</p></div><a class="text-link" href="/editor">Create in the full editor <LandingIcon name="direction" size={16} /></a></div><DirectionDemo showApi={false} initialTool="styles" /></section>
  </ProductShell>

<style>
  .toolkit-playground { margin-top: 60px; }
  .playground-heading { display: flex; align-items: end; justify-content: space-between; gap: 35px; margin-bottom: 25px; }
  .playground-heading p { color: var(--home-muted); font-size: 13px; line-height: 1.8; max-width: 68ch; margin-bottom: 0; }
  .playground-heading .text-link { flex-shrink: 0; font-size: 12px; }
  @media (max-width: 850px) { .playground-heading { flex-direction: column; align-items: start; gap: 20px; } }
</style>
