<script lang="ts">
  import { useConveyorMotion } from '../../composables/useConveyorMotion.svelte'
  import ConveyorScene from './ConveyorScene.svelte'
  import LandingIcon from './LandingIcon.svelte'
  import './conveyor.css'

  const motion = useConveyorMotion()
</script>

<section class="video-conveyor" aria-label="From media and YAML to MP4" data-running={motion.running} data-reduced-motion={motion.reducedMotion} use:motion.observe>
  <div class="conveyor-heading">
    <h2>A little direction. A finished film.</h2>
    {#if motion.reducedMotion}
      <span class="motion-note">Reduced motion</span>
    {/if}
  </div>
  <ConveyorScene compact={motion.compact} />
  <div class="conveyor-caption">
    <p><span>Your files.</span> <LandingIcon name="arrow" size={16} /> <span>Your recipe.</span> <LandingIcon name="arrow" size={16} /> <strong>Your story.</strong></p>
  </div>
</section>
