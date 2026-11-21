import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/svelte'
import { tick } from 'svelte'
import MediaImportStatus from '../../components/MediaImportStatus.svelte'
import type { MediaImportProgress } from '../../lib/media-item'

describe('MediaImportStatus', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-06T12:00:00Z'))
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it.each([
    { phase: 'metadata', label: 'Reading file' },
    { phase: 'saving', label: 'Saving on server' },
  ] as const)('shows $label and keeps elapsed time advancing without upload metrics', async ({ phase, label }) => {
    const progress: MediaImportProgress = {
      phase, fileName: 'clip.mp4', index: 2, total: 3, startedAt: Date.now(),
    }
    const { getByRole, getByText, getByLabelText, queryByText } = render(MediaImportStatus, { progress })

    expect(getByRole('status')).toHaveTextContent(label)
    expect(getByText('2 / 3')).toBeTruthy()
    expect(getByText('clip.mp4')).toHaveAttribute('title', 'clip.mp4')
    expect(getByLabelText('Upload progress for clip.mp4')).toHaveAttribute('max', '100')
    expect(getByText('0:00 elapsed')).toBeTruthy()
    expect(queryByText(/%$/)).toBeNull()
    expect(queryByText(/MB\/s$/)).toBeNull()
    expect(queryByText(/^About /)).toBeNull()

    await vi.advanceTimersByTimeAsync(65_000)
    await tick()

    expect(getByText('1:05 elapsed')).toBeTruthy()
  })

  it('shows percentage, MB/s and remaining time using upload time rather than metadata reading time', async () => {
    const progress: MediaImportProgress = {
      phase: 'uploading', fileName: 'clip.mp4', index: 1, total: 2,
      startedAt: Date.now() - 10_000, uploadStartedAt: Date.now() - 2_000,
      loaded: 2 * 1024 * 1024, size: 8 * 1024 * 1024,
    }
    const { getByRole, getByText, getByLabelText, queryByText, rerender } = render(MediaImportStatus, { progress })

    expect(getByRole('status')).toHaveTextContent('Uploading')
    expect(getByLabelText('Upload progress for clip.mp4')).toHaveAttribute('value', '25')
    expect(getByText('25%')).toBeTruthy()
    expect(getByText('1.0 MB/s')).toBeTruthy()
    expect(getByText('About 0:06 left')).toBeTruthy()
    expect(getByText('0:10 elapsed')).toBeTruthy()

    await vi.advanceTimersByTimeAsync(2_000)
    await tick()

    expect(getByText('0.5 MB/s')).toBeTruthy()
    expect(getByText('About 0:12 left')).toBeTruthy()
    expect(getByText('0:12 elapsed')).toBeTruthy()

    await rerender({ progress: { ...progress, loaded: 4 * 1024 * 1024 } })
    expect(getByText('50%')).toBeTruthy()
    expect(getByText('1.0 MB/s')).toBeTruthy()
    expect(getByText('About 0:04 left')).toBeTruthy()

    await rerender({ progress: { ...progress, phase: 'saving' } })
    expect(getByRole('status')).toHaveTextContent('Saving on server')
    expect(getByText('0:12 elapsed')).toBeTruthy()
    expect(queryByText(/%$/)).toBeNull()
    expect(queryByText(/MB\/s$/)).toBeNull()
    expect(queryByText(/^About /)).toBeNull()
  })

  it('avoids invalid percentage, speed and remaining estimates before any upload bytes arrive', () => {
    const progress: MediaImportProgress = {
      phase: 'uploading', fileName: 'empty.mp4', index: 1, total: 1,
      startedAt: Date.now(), uploadStartedAt: Date.now(), loaded: 0, size: 0,
    }
    const { getByRole, getByText, queryByText } = render(MediaImportStatus, { progress })

    expect(getByRole('status')).toHaveTextContent('Uploading')
    expect(getByText('0:00 elapsed')).toBeTruthy()
    expect(queryByText(/%|MB\/s|^About |NaN|Infinity/)).toBeNull()
  })

  it('keeps one elapsed timer across progress changes and clears it on unmount', async () => {
    const initialTimerCount = vi.getTimerCount()
    const progress: MediaImportProgress = {
      phase: 'metadata', fileName: 'clip.mp4', index: 1, total: 1, startedAt: Date.now(),
    }
    const { rerender, unmount } = render(MediaImportStatus, { progress })
    expect(vi.getTimerCount()).toBe(initialTimerCount + 1)

    await rerender({ progress: { ...progress, phase: 'saving' } })
    expect(vi.getTimerCount()).toBe(initialTimerCount + 1)

    unmount()
    expect(vi.getTimerCount()).toBe(initialTimerCount)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(vi.getTimerCount()).toBe(initialTimerCount)
  })
})
