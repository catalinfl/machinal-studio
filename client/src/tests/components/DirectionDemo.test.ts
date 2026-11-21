import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/svelte'
import DirectionDemo from '../../components/DirectionDemo.svelte'

vi.mock('../../composables/useLandingRenderer.svelte', () => ({
  useLandingRenderer: () => ({ host: undefined, phase: { kind: 'ready' } }),
}))

describe('Retained toolkit sandbox', () => {
  it('adds scenes, applies presets, edits text and resets', async () => {
    const { getByRole, container } = render(DirectionDemo)
    await fireEvent.click(getByRole('button', { name: 'Add The next move to timeline' }))
    expect(getByRole('button', { name: 'Select The next move timeline clip' })).toHaveAttribute('aria-pressed', 'true')
    await fireEvent.click(getByRole('button', { name: 'Styles' }))
    await fireEvent.click(getByRole('button', { name: /Silver Contrast/ }))
    expect(container.querySelector('.api-sample pre')?.textContent).toContain('silver-contrast')
    await fireEvent.click(getByRole('button', { name: 'Text' }))
    await fireEvent.click(getByRole('button', { name: 'Add title to timeline' }))
    await fireEvent.input(getByRole('textbox', { name: 'Edit sandbox title' }), { target: { value: 'A new direction.' } })
    expect(container.querySelector('.user-title')?.textContent).toBe('A new direction.')
    await fireEvent.click(getByRole('button', { name: 'Reset' }))
    expect(container.querySelectorAll('.timeline-clip')).toHaveLength(1)
    expect(container.querySelector('.user-title')).toBeNull()
  })

  it('connects clips and preserves keyboard-friendly reordering', async () => {
    const { getByRole, container } = render(DirectionDemo)
    await fireEvent.click(getByRole('button', { name: 'Add The next move to timeline' }))
    await fireEvent.click(getByRole('button', { name: 'Transitions' }))
    await fireEvent.click(getByRole('button', { name: /Cross Dissolve/ }))
    expect(container.querySelector('.transition-note')?.textContent).toContain('Cross Dissolve')
    expect(getByRole('button', { name: 'Preview Cross Dissolve between The idea and The next move' })).toBeTruthy()
    await fireEvent.click(getByRole('button', { name: 'Move selected clip earlier' }))
    expect(container.querySelector('.timeline-clip')?.getAttribute('aria-label')).toBe('Select The next move timeline clip')
  })
})
