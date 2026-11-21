<script lang="ts">
  const id = $props.id()
  const paint = (name: string) => `url(#${id}-${name})`
  const gear = Array.from({ length: 12 }, (_, tooth) =>
    [0, .18, .62, .8].map((offset, corner) => {
      const angle = (tooth + offset) * Math.PI / 6
      const radius = corner === 1 || corner === 2 ? 24 : 20
      return `${Math.cos(angle) * radius},${Math.sin(angle) * radius}`
    }).join(' '),
  ).join(' ')
  const bolts = [{ x: 15, y: 46 }, { x: 210, y: 47 }, { x: 15, y: 162 }, { x: 210, y: 162 }]
</script>

{#snippet cog(reverse = false)}
  <g class="motion machine-rotor" class:machine-rotor-reverse={reverse}>
    <polygon points={gear} fill={paint('gear')} stroke="#8f7ca9" stroke-width=".8" stroke-linejoin="round" />
    <circle r="17" fill="#675879" stroke="#dfcefa" stroke-width=".7" />
    {#each [0, 60, 120, 180, 240, 300] as angle}
      <path d="M-2-10v-4h4v4Z" transform={`rotate(${angle})`} fill="#33273f" stroke="#8f7ca9" stroke-width=".6" />
    {/each}
    <circle r="7" fill={paint('gear')} stroke="#33273f" />
    <path d="m-2-3 4 0 2 3-2 3h-4l-2-3Z" fill="#43344f" stroke="#dfcefa" stroke-width=".6" />
  </g>
{/snippet}

<g class="machine-assembly" aria-hidden="true">
  <defs>
    <linearGradient id={`${id}-casing`} x1="0" y1="0" x2="1" y2="1">
      <stop stop-color="#dfcefa" /><stop offset=".48" stop-color="#c6adff" /><stop offset="1" stop-color="#a78acc" />
    </linearGradient>
    <linearGradient id={`${id}-edge`} x1="0" y1="0" x2="1" y2="0">
      <stop stop-color="#8f7ca9" /><stop offset=".45" stop-color="#dfcefa" /><stop offset=".7" stop-color="#b9a8cc" /><stop offset="1" stop-color="#675879" />
    </linearGradient>
    <linearGradient id={`${id}-side`} x1="0" y1="0" x2="1" y2=".3">
      <stop stop-color="#8f7ca9" /><stop offset="1" stop-color="#59446f" />
    </linearGradient>
    <linearGradient id={`${id}-recess`} x1="0" y1="0" x2="0" y2="1">
      <stop stop-color="#21182c" /><stop offset="1" stop-color="#43344f" />
    </linearGradient>
    <linearGradient id={`${id}-gear`} x1="0" y1="0" x2=".7" y2="1">
      <stop stop-color="#f2ebff" /><stop offset=".5" stop-color="#b9a8cc" /><stop offset="1" stop-color="#8f7ca9" />
    </linearGradient>
    <clipPath id={`${id}-top`}><path d="M0 0H254V22L226 43H0Z" /></clipPath>
  </defs>

  <path d="M19 171h15v11l-3 3H21l-2-3Zm178 0h15v11l-3 3h-10l-2-3Z" fill="#43344f" stroke="#8f7ca9" />
  <path d="M20 177h13m165 0h13" stroke="#b9a8cc" />
  <path d="m224 35 29-16v131q0 8-7 13l-22 16Z" fill={paint('side')} stroke="#59446f" stroke-width="1.2" />
  <path d="m229 43 19-12v116q0 7-5 11l-14 9Z" fill="none" stroke="#b9a8cc" stroke-opacity=".5" />
  <image class="machine-original-top" href="/images/home/direction-machine-ai.png" width="254" height="191" preserveAspectRatio="xMidYMid meet" clip-path={`url(#${id}-top)`} />

  <path d="M13 33h202l11 11v124l-8 9H11l-9-9V44Z" fill="#675879" stroke="#43344f" stroke-width="1.2" />
  <path d="M14 38h198l9 9v119l-6 6H14l-7-7V46Z" fill={paint('casing')} stroke="#dfcefa" />
  <path d="M22 76h179l-8 8H30Z" fill="#8f7ca9" />
  <text x="23" y="65" fill="#33273f" font-size="21" font-weight="600" letter-spacing="-.8">machinal</text>
  <path d="m186 64 14-14m-14 0h14v14" stroke="#593495" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />

  <path d="M30 83h163l7 7v48l-7 8H30l-7-8V90Z" fill={paint('recess')} stroke="#8f7ca9" stroke-width="2" />
  <path d="M31 86h160l6 6M26 137l6 6h159" stroke="#dfcefa" stroke-opacity=".3" />
  <g class="machine-gears" transform="translate(32 0)">
    <circle cx="65" cy="113" r="27" fill="#21182c" stroke="#675879" />
    <g transform="translate(65 113)">{@render cog()}</g>
    <g transform="translate(101 120) scale(.68)">{@render cog(true)}</g>
  </g>

  {#each [11, 204] as x}
    <path d={`M${x} 80h9v69h-9Z`} fill={paint('edge')} stroke="#8f7ca9" stroke-width=".6" />
    <path d={`M${x + 3} 85v58`} stroke="#f2ebff" stroke-opacity=".5" />
  {/each}
  <path d="M28 153h166" stroke="#8f7ca9" stroke-width="4" stroke-linecap="round" />
  <path class="motion machine-meter" d="M32 153h157" stroke="#593495" stroke-width="2" stroke-linecap="round" />
  <path d="M28 152h166" stroke="#f2ebff" stroke-opacity=".5" stroke-width=".6" />

  {#each bolts as bolt}
    <g transform={`translate(${bolt.x} ${bolt.y})`}>
      <circle r="2.7" fill="#675879" stroke="#f2ebff" stroke-width=".7" />
      <path d="m-1.1 1.1 2.2-2.2" stroke="#dfcefa" stroke-width=".8" />
    </g>
  {/each}
  <g stroke="#21182c" stroke-width="2.5" stroke-linecap="round">
    <path d="m235 37 11-7m-11 12 11-7m-11 12 11-7" />
    <path d="m236 153 8-5m-8 9 8-5" />
  </g>
  <path d="M9 170h211" stroke="#43344f" stroke-width="3" />
  <circle class="motion machine-light" cx="25" cy="164" r="2.3" fill="#593495" stroke="#f2ebff" stroke-width=".7" />
  <circle class="motion machine-light light-two" cx="35" cy="164" r="2.3" fill="#593495" stroke="#f2ebff" stroke-width=".7" />
  <circle class="motion machine-light light-three" cx="45" cy="164" r="2.3" fill="#593495" stroke="#f2ebff" stroke-width=".7" />
</g>
