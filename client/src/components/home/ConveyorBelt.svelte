<script lang="ts">
  let { compact }: { compact: boolean } = $props()
  const id = $props.id()
  const layout = $derived(compact ? {
    path: 'M24 314H506Q566 314 566 374V470Q566 530 506 530H76',
    floor: 'M28 567h564',
    supports: [{ x: 62, y: 332, height: 18 }, { x: 275, y: 332, height: 18 }, { x: 115, y: 548, height: 14 }, { x: 514, y: 548, height: 14 }],
    rollers: [{ x: 24, y: 314 }, { x: 76, y: 530 }],
    fasteners: [{ x: 125, y: 325 }, { x: 222, y: 325 }, { x: 319, y: 325 }, { x: 416, y: 325 }, { x: 179, y: 541 }, { x: 290, y: 541 }, { x: 401, y: 541 }],
  } : {
    path: 'M18 299H1182',
    floor: 'M18 352h1164',
    supports: [{ x: 64, y: 317, height: 29 }, { x: 389, y: 317, height: 29 }, { x: 825, y: 317, height: 29 }, { x: 1136, y: 317, height: 29 }],
    rollers: [{ x: 18, y: 299 }, { x: 1182, y: 299 }],
    fasteners: [{ x: 138, y: 310 }, { x: 264, y: 310 }, { x: 451, y: 310 }, { x: 765, y: 310 }, { x: 953, y: 310 }, { x: 1079, y: 310 }],
  })
</script>

<g class="conveyor-belt" aria-hidden="true">
  <defs>
    <linearGradient id={`${id}-metal`} x1="0" y1="0" x2="0" y2="1">
      <stop stop-color="#f2ebff" /><stop offset=".45" stop-color="#b9a8cc" /><stop offset="1" stop-color="#8f7ca9" />
    </linearGradient>
  </defs>
  <path class="conveyor-floor" d={layout.floor} />
  {#each layout.supports as support}
    <g transform={`translate(${support.x} ${support.y})`}>
      <path class="belt-leg" d={`M-4 0h8v${support.height}h-8Z`} fill={`url(#${id}-metal)`} />
      <path class="belt-brace" d={`M4 4 17 ${support.height - 2}`} />
      <path class="belt-leg-highlight" d={`M-1 3v${support.height - 5}`} />
      <rect class="belt-bracket" x="-10" y="-3" width="20" height="7" rx="1" />
      <path class="belt-foot" d={`M-10 ${support.height - 2}h20l3 4h-26Z`} />
    </g>
  {/each}
  <path class="belt-outline" d={layout.path} />
  <path class="belt-chassis" d={layout.path} />
  <path class="belt-bottom-rail" d={layout.path} transform="translate(0 11)" />
  <path class="belt-surface" d={layout.path} />
  <path class="motion belt-treads" d={layout.path} transform="translate(0 -3)" />
  <path class="belt-rail" d={layout.path} transform="translate(0 -12)" />
  <path class="belt-track-edge" d={layout.path} transform="translate(0 6)" />
  {#each layout.fasteners as fastener}
    <circle class="belt-fastener" cx={fastener.x} cy={fastener.y} r="1.5" />
  {/each}
  {#each layout.rollers as roller}
    <g transform={`translate(${roller.x} ${roller.y})`}>
      <circle class="belt-roller" r="13" fill={`url(#${id}-metal)`} />
      <circle class="belt-bearing" r="9" />
      <path class="motion belt-wheel" d="M-6 0H6M0-6V6" />
      <circle class="belt-hub" r="4" />
    </g>
  {/each}
</g>
