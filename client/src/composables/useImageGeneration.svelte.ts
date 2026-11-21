import { executeAIImageJob, importProxyImage, type AIImageJob } from '../lib/ai-image'

export type ImageGenerationPhase =
  | { kind: 'idle' }
  | { kind: 'uploading' }
  | { kind: 'generating'; message: string }
  | { kind: 'success'; message: string; resultName: string }
  | { kind: 'error'; message: string }

export type ImageGenerationRequest = AIImageJob & {
  mode: 'generate' | 'edit'
}

export class ImageGeneration {
  phase = $state<ImageGenerationPhase>({ kind: 'idle' })

  #requestController: AbortController | null = null

  get busy(): boolean {
    return this.phase.kind === 'generating' || this.phase.kind === 'uploading'
  }

  get progress(): string {
    return this.phase.kind === 'generating' || this.phase.kind === 'success' ? this.phase.message : ''
  }

  get error(): string {
    return this.phase.kind === 'error' ? this.phase.message : ''
  }

  get resultName(): string {
    return this.phase.kind === 'success' ? this.phase.resultName : ''
  }

  async generate(request: ImageGenerationRequest): Promise<void> {
    if (this.busy || !request.prompt.trim()) return
    if (request.mode === 'edit' && !request.sourceName) {
      this.phase = { kind: 'error', message: 'Choose a Proxy image to edit.' }
      return
    }

    this.phase = {
      kind: 'generating',
      message: request.mode === 'edit' ? 'Reworking the selected image…' : 'Generating the image…',
    }
    this.#requestController?.abort()
    const controller = new AbortController()
    this.#requestController = controller

    try {
      const { mode, ...job } = request
      const execution = await executeAIImageJob({
        ...job,
        prompt: job.prompt.trim(),
        ...(mode === 'edit' ? { sourceName: request.sourceName } : {}),
      }, controller.signal)
      if (this.#requestController !== controller) return
      const destinationMessage = execution.clip
        ? 'Overlay added to the timeline.'
        : 'Image added to the Media Bin.'
      this.phase = {
        kind: 'success',
        resultName: execution.asset.name,
        message: execution.asset.warning
          ? `${destinationMessage} ${execution.asset.warning}`
          : destinationMessage,
      }
    } catch (cause) {
      if (this.#requestController !== controller) return
      if (!(cause instanceof DOMException && cause.name === 'AbortError')) {
        this.phase = {
          kind: 'error',
          message: cause instanceof Error ? cause.message : 'Image generation failed. Try again.',
        }
      } else {
        this.phase = { kind: 'idle' }
      }
    } finally {
      if (this.#requestController === controller) this.#requestController = null
    }
  }

  async upload(file: File | undefined, proxyEditingAvailable: boolean): Promise<string | undefined> {
    if (!file || this.busy || !proxyEditingAvailable) return undefined

    this.phase = { kind: 'uploading' }
    try {
      const name = await importProxyImage(file)
      this.phase = { kind: 'idle' }
      return name
    } catch (cause) {
      this.phase = {
        kind: 'error',
        message: cause instanceof Error ? cause.message : 'The image could not be uploaded.',
      }
      return undefined
    }
  }

  clearError(): void {
    if (this.phase.kind === 'error') this.phase = { kind: 'idle' }
  }

  /** Test-only reset so generation state never leaks between test cases. */
  reset(): void {
    this.#requestController?.abort()
    this.#requestController = null
    this.phase = { kind: 'idle' }
  }
}

// Shared instance: image generation keeps running (and its result stays
// visible) when the user switches to another tab, which unmounts the panel.
const sharedImageGeneration = new ImageGeneration()

export function useImageGeneration(): ImageGeneration {
  return sharedImageGeneration
}

export function resetImageGeneration(): void {
  sharedImageGeneration.reset()
}
