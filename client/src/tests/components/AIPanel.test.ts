import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, waitFor } from '@testing-library/svelte'
import AIPanel from '../../components/AIPanel.svelte'

const aiEdit = vi.hoisted(() => ({
  plan: vi.fn(),
  apply: vi.fn(),
}))

vi.mock('../../lib/ai-edit', () => ({
  planAIEdit: aiEdit.plan,
  applyAIEditPlan: aiEdit.apply,
}))

describe('AIPanel', () => {
  beforeEach(() => {
    aiEdit.plan.mockReset()
    aiEdit.apply.mockReset()
  })

  it('reports a no-safe-changes fallback as an error instead of a completed edit', async () => {
    aiEdit.plan.mockResolvedValue({
      revision: 'rev-1',
      plan: {
        revision: 'rev-1',
        summary: 'No safe timeline changes were available for this request.',
        operations: [],
      },
    })
    const panel = render(AIPanel, { props: { instruction: 'Add all images' } })

    await fireEvent.click(panel.getByRole('button', { name: 'Edit timeline' }))

    await waitFor(() => expect(panel.getByRole('alert')).toHaveTextContent('No safe timeline changes were available for this request.'))
    expect(panel.queryByText('AI Edit complete')).not.toBeInTheDocument()
    expect(panel.queryByText('Use Undo to revert the complete AI edit.')).not.toBeInTheDocument()
    expect(aiEdit.apply).not.toHaveBeenCalled()
  })

  it('shows an executable recommendation without applying it automatically', async () => {
    const plan = {
      revision: 'rev-1',
      mode: 'recommend' as const,
      summary: 'Use a transparent editorial calendar overlay at the playhead.',
      imageJobs: [{
        id: 'calendar', prompt: 'A calendar and clock', style: 'editorial cutout', placement: 'overlay' as const,
        position: 'right' as const, start: 2, duration: 4, background: 'transparent' as const,
        quality: 'high' as const, motionPreset: 'none' as const,
      }],
      operations: [],
    }
    aiEdit.plan.mockResolvedValue({ revision: 'rev-1', plan })
    aiEdit.apply.mockResolvedValue(1)
    const panel = render(AIPanel, { props: { instruction: 'Ce overlay recomanzi?' } })

    await fireEvent.click(panel.getByRole('button', { name: 'Edit timeline' }))

    const applyButton = await panel.findByRole('button', { name: 'Apply recommendation' })
    expect(panel.getByRole('status')).toHaveTextContent('transparent editorial calendar')
    expect(aiEdit.apply).not.toHaveBeenCalled()

    await fireEvent.click(applyButton)

    await waitFor(() => expect(aiEdit.apply).toHaveBeenCalledWith(plan, 'rev-1', expect.any(AbortSignal)))
    await waitFor(() => expect(panel.getByRole('status')).toHaveTextContent('Recommendation applied'))
    expect(panel.queryByRole('button', { name: 'Apply recommendation' })).not.toBeInTheDocument()
  })

  it('keeps the user updated while a long edit is being prepared', async () => {
    vi.useFakeTimers()
    let resolvePlan!: (value: unknown) => void
    aiEdit.plan.mockImplementation(() => new Promise((resolve) => { resolvePlan = resolve }))
    aiEdit.apply.mockResolvedValue(1)
    const panel = render(AIPanel, { props: { instruction: 'Make a highlight edit' } })

    await fireEvent.click(panel.getByRole('button', { name: 'Edit timeline' }))
    expect(panel.getByRole('status')).toHaveTextContent('Looking through your footage')

    await vi.advanceTimersByTimeAsync(6000)
    expect(panel.getByRole('status')).toHaveTextContent('Finding the moments')

    resolvePlan({
      revision: 'rev-1',
      plan: { revision: 'rev-1', summary: 'Your highlight is ready.', operations: [{ type: 'undo' }] },
    })
    await vi.runAllTimersAsync()
    await waitFor(() => expect(panel.getByRole('status')).toHaveTextContent('Your highlight is ready.'))
    vi.useRealTimers()
  })

  it('shows speech generation progress while applying a voice-over plan', async () => {
    let resolveApply!: (value: number) => void
    const plan = {
      revision: 'rev-1',
      summary: 'Added a voice-over.',
      speechJobs: [{
        id: 'intro', input: 'Welcome', model: 'x-ai/grok-voice-tts-1.0', voice: 'eve', start: 0,
      }],
      operations: [],
    }
    aiEdit.plan.mockResolvedValue({ revision: 'rev-1', plan })
    aiEdit.apply.mockImplementation(() => new Promise<number>((resolve) => { resolveApply = resolve }))
    const panel = render(AIPanel, { props: { instruction: 'Add a voice-over saying Welcome' } })

    await fireEvent.click(panel.getByRole('button', { name: 'Edit timeline' }))

    await waitFor(() => expect(panel.getByRole('status')).toHaveTextContent('Generating and placing your requested voice-over'))
    resolveApply(1)
    await waitFor(() => expect(panel.getByRole('status')).toHaveTextContent('Added a voice-over'))
  })
})
