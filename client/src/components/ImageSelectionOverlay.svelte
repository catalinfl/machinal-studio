<script lang="ts">
  interface ImageSelectionRect {
    left: number
    top: number
    width: number
    height: number
  }

  type ImageResizeCorner = 'nw' | 'ne' | 'sw' | 'se'

  let {
    rect,
    locked,
    zoom,
    mediaLabel = 'image',
    onResizeStart,
    onResizeKeyboard,
  }: {
    rect: ImageSelectionRect
    locked: boolean
    zoom: number
    mediaLabel?: string
    onResizeStart: (event: PointerEvent) => void
    onResizeKeyboard: (event: KeyboardEvent) => void
  } = $props()

  const corners: ImageResizeCorner[] = ['nw', 'ne', 'sw', 'se']
</script>

<div
  class="image-selection"
  style="left:{rect.left}px; top:{rect.top}px; width:{rect.width}px; height:{rect.height}px"
>
  {#each corners as corner}
    <span
      class="image-resize-handle handle-{corner}"
      data-resize-corner={corner}
      role="slider"
      tabindex={locked ? -1 : 0}
      aria-label="Resize {mediaLabel} from {corner} corner"
      aria-valuemin="0.01"
      aria-valuemax="40"
      aria-valuenow={zoom}
      aria-valuetext={`${Math.round(zoom * 100)}%`}
      aria-disabled={locked}
      onpointerdown={onResizeStart}
      onkeydown={onResizeKeyboard}
    ></span>
  {/each}
</div>

<style>
  .image-selection {
    position: absolute;
    z-index: 2;
    box-sizing: border-box;
    border: 1px solid var(--primary);
    box-shadow: 0 0 0 1px rgb(255 255 255 / 72%);
    pointer-events: none;
  }
  .image-resize-handle {
    position: absolute;
    width: 18px;
    height: 18px;
    transform: translate(-50%, -50%);
    pointer-events: auto;
    touch-action: none;
  }
  .image-resize-handle::after {
    content: '';
    position: absolute;
    top: 50%;
    left: 50%;
    width: 8px;
    height: 8px;
    transform: translate(-50%, -50%);
    border: 1px solid var(--surface-elevated);
    background: var(--primary);
  }
  .image-resize-handle:focus-visible { outline: 2px solid var(--ring); outline-offset: 1px; }
  .handle-nw { left: 0; top: 0; cursor: nwse-resize; }
  .handle-ne { left: 100%; top: 0; cursor: nesw-resize; }
  .handle-sw { left: 0; top: 100%; cursor: nesw-resize; }
  .handle-se { left: 100%; top: 100%; cursor: nwse-resize; }
  @media (pointer: coarse) {
    .image-resize-handle { width: 44px; height: 44px; }
    .handle-nw { transform: none; }
    .handle-ne { transform: translate(-100%, 0); }
    .handle-sw { transform: translate(0, -100%); }
    .handle-se { transform: translate(-100%, -100%); }
    .handle-nw::after { top: 0; left: 0; }
    .handle-ne::after { top: 0; left: 100%; }
    .handle-sw::after { top: 100%; left: 0; }
    .handle-se::after { top: 100%; left: 100%; }
  }
</style>
