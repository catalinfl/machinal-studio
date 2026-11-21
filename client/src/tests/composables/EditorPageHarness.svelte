<script lang="ts">
  import { onMount } from 'svelte'
  import { useEditorPage } from '../../composables/useEditorPage.svelte'

  let { onReady }: { onReady: (page: ReturnType<typeof useEditorPage>) => void } = $props()
  const page = useEditorPage()
  onMount(() => onReady(page))
</script>

<output>{page.activePanel}</output>
