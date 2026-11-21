<script lang="ts">
  import ConveyorMedia from './ConveyorMedia.svelte'
  import ConveyorRecipe from './ConveyorRecipe.svelte'
  import ConveyorMachine from './ConveyorMachine.svelte'
  import ConveyorBelt from './ConveyorBelt.svelte'

  let { compact }: { compact: boolean } = $props()
  const id = $props.id()
  const recipeSlotId = `${id}-recipe-slot`
  const machineShellId = `${id}-machine-shell`
  const outletRevealId = `${id}-outlet-reveal`

  const layout = $derived(compact ? {
    viewBox: '0 0 620 620',
    machine: 'translate(338 175)', recipe: 'translate(382 9)', result: 'translate(118 418)',
    recipeClip: 'M0 0H620V189H567L548 201H0Z',
    media: 'translate(18 202)', sourceWidth: 140, clipWidth: 520,
  } : {
    viewBox: '0 0 1200 390',
    machine: 'translate(482 151)', recipe: 'translate(528 9)', result: 'translate(900 169)',
    recipeClip: 'M0 0H1200V165H711L692 177H0Z',
    media: 'translate(18 169)', sourceWidth: 166, clipWidth: 664,
  })

  const outletHeight = $derived(layout.sourceWidth * 126 / 180 * .74)
  const machineSlot = $derived(`M233 ${142 - outletHeight}L243 ${135 - outletHeight}V135L233 142Z`)
  const outletLip = $derived(`M243 ${135 - outletHeight}L233 ${142 - outletHeight}V142L243 135`)
  const outletReveal = $derived(`M233 ${142 - outletHeight}L243 ${135 - outletHeight}H254V-175H1200V620H-482V191H254V135H243L233 142Z`)
</script>

<svg class="conveyor-scene" class:compact viewBox={layout.viewBox} fill="none" role="img" aria-label="Video and images travel on a conveyor into machinal. A YAML recipe adds a Warm Memory style, a Cross Dissolve transition and title text. A finished MP4 emerges and plays the same two landscapes.">
  <defs>
    <clipPath id={id}><rect x="18" y="150" width={layout.clipWidth} height="164" /></clipPath>
    <clipPath id={recipeSlotId} clipPathUnits="userSpaceOnUse"><path d={layout.recipeClip} /></clipPath>
    <clipPath id={machineShellId} clipPathUnits="userSpaceOnUse"><path d={`M0 0H254V191H0Z ${machineSlot}`} clip-rule="evenodd" /></clipPath>
    <clipPath id={outletRevealId} clipPathUnits="userSpaceOnUse"><path transform={layout.machine} d={outletReveal} /></clipPath>
  </defs>

  <g aria-hidden="true">
    <ConveyorBelt {compact} />
    <g class="flow-label motion media-phase" transform={compact ? 'translate(30 155)' : 'translate(67 118)'}>
      <text>Your media</text><path d="M122-6h29m-6-6 6 6-6 6" />
    </g>
    <g class="flow-label motion result-phase" transform={compact ? 'translate(119 590)' : 'translate(900 80)'}>
      <text>Your next video</text><path d="m177-12 4 4 8-9" />
    </g>
    {#if !compact}
      <g class="motion recipe-phase">
        <path class="feed-guide" d="M708 35h38v80m-5-6 5 6 5-6" />
        <text x="763" y="53" class="scene-note">Your recipe.</text>
        <text x="763" y="74" class="scene-note">Your rules.</text>
      </g>
    {/if}
  </g>

  <g class="media-feed-window" clip-path={`url(#${id})`}>
    <g transform={layout.media}>
      <g class="incoming-media">
        <g class="motion source-video"><g class="motion intake-video"><ConveyorMedia kind="video" width={layout.sourceWidth} /></g></g>
        <g class="motion source-image"><g class="motion intake-image"><ConveyorMedia kind="image" width={layout.sourceWidth} /></g></g>
      </g>
    </g>
  </g>
  <g transform={layout.machine} aria-hidden="true"><path class="machine-outlet-cavity" d={machineSlot} fill="#21182c" /></g>
  <g class="machine-foreground" transform={layout.machine} clip-path={`url(#${machineShellId})`}><ConveyorMachine /></g>
  <g transform={layout.machine} aria-hidden="true"><path d={machineSlot} fill="none" stroke="#675879" stroke-width="1.4" /></g>
  <g class="result-feed-window" clip-path={`url(#${outletRevealId})`}>
    <g transform={layout.result}>
      <g class="motion outgoing-film"><g class="motion film-size"><ConveyorMedia kind="result" width={layout.sourceWidth} /></g></g>
    </g>
  </g>
  <g transform={layout.machine} aria-hidden="true"><path class="machine-outlet-lip" d={outletLip} fill="none" stroke="#675879" stroke-width="1.4" /></g>
  <g class="recipe-feed-window" clip-path={`url(#${recipeSlotId})`}>
    <g transform={layout.recipe}><g class="motion incoming-recipe"><ConveyorRecipe /></g></g>
  </g>

  <g class="motion render-spark" transform={compact ? 'translate(605 204)' : 'translate(770 184)'} aria-hidden="true">
    <path d="M-9 0H9M0-9V9m22 12h10m-5-5v10" />
  </g>
  <g class="flow-arrow motion result-phase" transform={compact ? 'translate(39 389)' : 'translate(793 219)'} aria-hidden="true">
    <path d={compact ? 'M0 0v47m-6-6 6 6 6-6' : 'M0 0h52m-7-7 7 7-7 7'} />
  </g>
</svg>
