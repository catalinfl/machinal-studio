import { onDestroy } from 'svelte'
import { applyAIEditPlan, planAIEdit } from '../lib/ai-edit'
import type { AIEditPlan } from '../lib/api'

export type AIEditLifecycle =
  | { kind: 'idle'; result: null; recommendation: AIRecommendation | null }
  | { kind: 'working'; progress: string; result: string | null; recommendation: AIRecommendation | null }
  | { kind: 'success'; result: string; recommendation: AIRecommendation | null }
  | { kind: 'error'; message: string; result: string | null; recommendation: AIRecommendation | null }

export type AIRecommendation = { plan: AIEditPlan; revision: string }

const progressMessages = [
  'Looking through your footage and shaping the edit.',
  'Finding the moments that best fit your request.',
  'Your edit is taking shape. A little more time can make it better.',
  'Still shaping your edit. Longer videos can take a little more time.',
]

const fastProgressMessages = [
  'Choosing the right tools for your edit.',
  'Checking your footage when the edit needs it.',
  'Shaping your timeline from your request.',
]

function isAbortError(cause: unknown): boolean {
  return cause instanceof DOMException && cause.name === 'AbortError'
}

function withElapsed(message: string, seconds: number): string {
  if (seconds <= 0) return message
  return `${message} (${seconds}s)`
}

export function useAIEdit() {
  let lifecycle = $state<AIEditLifecycle>({ kind: 'idle', result: null, recommendation: null })
  let fast = $state(false)
  let elapsedSeconds = $state(0)
  let requestController: AbortController | null = null
  let progressTimer: ReturnType<typeof setInterval> | null = null
  let elapsedTimer: ReturnType<typeof setInterval> | null = null

  function stopProgress() {
    if (progressTimer === null && elapsedTimer === null) return
    if (progressTimer !== null) clearInterval(progressTimer)
    if (elapsedTimer !== null) clearInterval(elapsedTimer)
    progressTimer = null
    elapsedTimer = null
  }

  function setWorking(progress: string, result: string | null, recommendation: AIRecommendation | null = null) {
    lifecycle = { kind: 'working', progress, result, recommendation }
  }

  function startRequest(
    progress: string,
    result: string | null,
    rotateProgress: boolean,
    recommendation: AIRecommendation | null = null,
  ): AbortController {
    requestController?.abort()
    stopProgress()
    const controller = new AbortController()
    requestController = controller
    elapsedSeconds = 0
    setWorking(withElapsed(progress, 0), result, recommendation)

    if (rotateProgress) {
      const messages = fast ? fastProgressMessages : progressMessages
      let messageIndex = 0
      elapsedTimer = setInterval(() => {
        elapsedSeconds += 1
        if (lifecycle.kind === 'working') {
          const base = messages[Math.min(messageIndex, messages.length - 1)]
          setWorking(withElapsed(base, elapsedSeconds), lifecycle.result, lifecycle.recommendation)
        }
      }, 1000)
      progressTimer = setInterval(() => {
        if (messageIndex >= messages.length - 1 || lifecycle.kind !== 'working') return
        messageIndex += 1
        setWorking(withElapsed(messages[messageIndex], elapsedSeconds), lifecycle.result, lifecycle.recommendation)
      }, 6000)
    }

    return controller
  }

  function finishRequest(controller: AbortController) {
    if (requestController !== controller) return
    stopProgress()
    requestController = null
    if (lifecycle.kind !== 'working') return
    lifecycle = lifecycle.result === null
      ? { kind: 'idle', result: null, recommendation: lifecycle.recommendation }
      : { kind: 'success', result: lifecycle.result, recommendation: lifecycle.recommendation }
  }

  function setError(cause: unknown, fallback: string) {
    lifecycle = {
      kind: 'error',
      message: cause instanceof Error ? cause.message : fallback,
      result: lifecycle.result,
      recommendation: lifecycle.recommendation,
    }
  }

  async function submit(instruction: string, useFast?: boolean) {
    const request = instruction.trim()
    if (!request || lifecycle.kind === 'working') return
    const wantFast = useFast ?? fast

    const controller = startRequest((wantFast ? fastProgressMessages : progressMessages)[0], null, true)
    try {
      const response = await planAIEdit(request, controller.signal, wantFast)
      if (response.plan.operations.length === 0 && /no safe timeline changes/i.test(response.plan.summary)) {
        throw new Error(response.plan.summary)
      }
      if (response.plan.mode === 'recommend') {
        lifecycle = {
          kind: 'success',
          result: response.plan.summary || 'A timeline recommendation is ready.',
          recommendation: response,
        }
        return
      }
      setWorking(
        response.plan.speechJobs?.length
          ? 'Generating and placing your requested voice-over.'
          : response.plan.imageJobs?.length
            ? 'Generating and placing your requested images.'
            : 'Putting the finishing touches on your timeline.',
        null,
      )
      const applied = await applyAIEditPlan(response.plan, response.revision, controller.signal)
      lifecycle = {
        kind: 'success',
        result: response.plan.summary || (applied === 0 ? 'No timeline changes were needed.' : 'Your timeline is ready.'),
        recommendation: null,
      }
    } catch (cause) {
      if (!isAbortError(cause) && requestController === controller) setError(cause, 'AI edit failed. Try again.')
    } finally {
      finishRequest(controller)
    }
  }

  async function applyRecommendation() {
    const recommendation = lifecycle.kind === 'success' ? lifecycle.recommendation : null
    if (!recommendation || lifecycle.kind === 'working') return

    const controller = startRequest(
      recommendation.plan.speechJobs?.length
        ? 'Generating the recommended voice-over and applying it.'
        : recommendation.plan.imageJobs?.length
          ? 'Generating the recommended images and applying them.'
          : 'Applying the recommendation to your timeline.',
      lifecycle.result,
      false,
      recommendation,
    )
    try {
      const applied = await applyAIEditPlan(recommendation.plan, recommendation.revision, controller.signal)
      lifecycle = {
        kind: 'success',
        result: applied === 0 ? 'No timeline changes were needed.' : 'Recommendation applied. Your timeline is ready.',
        recommendation: null,
      }
    } catch (cause) {
      if (!isAbortError(cause) && requestController === controller) {
        setError(cause, 'The recommendation could not be applied.')
      }
    } finally {
      finishRequest(controller)
    }
  }

  function abortActiveRequest() {
    requestController?.abort()
  }

  onDestroy(() => {
    abortActiveRequest()
    stopProgress()
  })

  return {
    get lifecycle() { return lifecycle },
    get fast() { return fast },
    set fast(value: boolean) { fast = value },
    get elapsedSeconds() { return elapsedSeconds },
    get pendingRecommendation() {
      return lifecycle.kind === 'success' ? lifecycle.recommendation : null
    },
    submit,
    applyRecommendation,
  }
}
