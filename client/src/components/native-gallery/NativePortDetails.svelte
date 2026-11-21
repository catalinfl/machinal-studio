<script lang="ts">
  import type { NativePort } from '../../lib/native-gallery-catalog'

  let { port }: { port: NativePort } = $props()
</script>

<details class="ng-port-details">
  <summary>Port information <span>{port.category} · {port.visualMode}</span></summary>
  <div class="ng-port-details-content">
    <div>
      <span>Source</span>
      <code>{port.nativePath}</code>
    </div>
    {#if port.requiredImages.length || port.requiredVideos.length}
      <div>
        <span>Media slots</span>
        <p>
          {#if port.requiredImages.length}{port.requiredImages.length} image{port.requiredImages.length === 1 ? '' : 's'}{/if}
          {#if port.requiredImages.length && port.requiredVideos.length} · {/if}
          {#if port.requiredVideos.length}{port.requiredVideos.length} video{port.requiredVideos.length === 1 ? '' : 's'}{/if}
          are filled with local synthetic fixtures in this gallery.
        </p>
      </div>
    {/if}
    {#if port.notes.length}
      <div>
        <span>Adaptation notes</span>
        <ul>{#each port.notes as note}<li>{note}</li>{/each}</ul>
      </div>
    {/if}
  </div>
</details>
