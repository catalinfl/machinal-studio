<script lang="ts">
  import CaptionEditorDialog from './CaptionEditorDialog.svelte'
  import CaptionSourceDialog from './CaptionSourceDialog.svelte'
  import { captions } from '../stores/captions.svelte'
  import { editor } from '../stores/editor.svelte'
</script>

<!--
  Caption dialogs live above the side panels (rendered from Editor.svelte) so
  a running transcription and its review stay available when the user switches
  to another tab, and generated drafts survive closing the review with X.
-->
{#if captions.captionSourceDialogOpen}
  <CaptionSourceDialog initialSelectedClips={captions.captionSourceSelection} onCancel={captions.cancelSourceSelection} onSelect={captions.generateFromSources} />
{/if}

{#if captions.captionDialogOpen && captions.captionDrafts.length > 0}
  <CaptionEditorDialog drafts={captions.captionDrafts} maxItems={100 - editor.textItems.length} mode={captions.captionDialogMode} kind={captions.captionDialogKind} onCancel={captions.dismissCaptionDialog} onAdd={captions.captionDialogMode === 'edit' ? captions.saveCaptionDrafts : captions.addCaptionDrafts} />
{/if}
