import { onDestroy } from 'svelte'

type RenderPhase =
  | { kind: 'idle' }
  | { kind: 'uploading' | 'compiling' | 'rendering'; progress: number }
  | { kind: 'completed' }

export function useRenderDemo() {
  let phase = $state<RenderPhase>({ kind: 'idle' })
  let timer: ReturnType<typeof setInterval> | undefined

  function stop() {
    clearInterval(timer)
    timer = undefined
  }

  function run() {
    stop()
    let progress = 0
    phase = { kind: 'uploading', progress }
    timer = setInterval(() => {
      progress += 5
      if (progress >= 100) {
        phase = { kind: 'completed' }
        stop()
        return
      }
      const kind = progress < 20 ? 'uploading' : progress < 35 ? 'compiling' : 'rendering'
      phase = { kind, progress }
    }, 160)
  }

  function reset() {
    stop()
    phase = { kind: 'idle' }
  }

  onDestroy(stop)

  return {
    run,
    reset,
    get phase() { return phase },
    get busy() { return phase.kind !== 'idle' && phase.kind !== 'completed' },
  }
}
