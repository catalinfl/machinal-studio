import { describe, expect, it } from 'vitest'
import { downloadableJob, jobProgress, jobWaitLabel, safeDownloadURL, sortJobs, type JobSummary } from '../../lib/job-monitor'

const job: JobSummary = { id: 'job', kind: 'render', status: 'running', progress: 0.5, createdAt: '2026-10-26T12:00:00Z', updatedAt: '2026-10-26T12:01:00Z' }

describe('job monitor presentation', () => {
  it('does not invent a completion time or confuse upload progress with completion', () => {
    expect(jobWaitLabel(job)).toContain('Estimating')
    expect(downloadableJob({ ...job, progress: 1, filename: 'render.mp4' })).toBe(false)
    expect(downloadableJob({ ...job, status: 'completed', filename: 'render.mp4' })).toBe(true)
    expect(downloadableJob({ ...job, kind: 'ai-image', status: 'completed', filename: 'image.png' })).toBe(false)
  })

  it('labels progress and queue estimates as approximate', () => {
    expect(jobWaitLabel({ ...job, timing: { approximate: true, basis: 'progress', remainingSeconds: 120 } })).toBe('About 2 min remaining')
    expect(jobWaitLabel({ ...job, status: 'queued', timing: { approximate: true, basis: 'recent-jobs', estimatedQueueSeconds: 40 } })).toBe('About less than a minute before processing')
    expect(jobWaitLabel({ ...job, timing: { approximate: true, basis: 'progress', remainingSeconds: Number.NaN } })).toContain('Estimating')
  })

  it('distinguishes current scene capture from full export time', () => {
    expect(jobWaitLabel({ ...job, stage: { name: 'capture', index: 2, count: 7, completed: 100, total: 200 }, timing: { approximate: true, basis: 'unknown', stageBasis: 'scene-frames', stageRemainingSeconds: 120 } })).toBe('About 2 min for this scene’s frames (not the full export)')
    expect(jobWaitLabel({ ...job, stage: { name: 'encoding' }, timing: { approximate: true, basis: 'unknown', stageRemainingSeconds: 120 } })).toContain('no reliable estimate')
  })

  it('bounds progress and sorts active jobs first without mutating API results', () => {
    expect(jobProgress({ ...job, progress: 3 })).toBe(100)
    expect(jobProgress({ ...job, progress: Number.NaN })).toBe(0)
    const input = [{ ...job, id: 'done', status: 'completed' as const }, job]
    expect(sortJobs(input)[0].id).toBe('job')
    expect(input[0].id).toBe('done')
  })

  it('rejects executable or credential-bearing download URLs', () => {
    for (const value of ['javascript:alert(1)', 'data:text/html,hello', 'https://secret@example.test/video', 'http://external.test/video']) {
      expect(() => safeDownloadURL(value)).toThrow()
    }
    expect(safeDownloadURL('https://storage.example.test/video?signature=test')).toContain('storage.example.test')
    expect(safeDownloadURL('http://127.0.0.1:9000/video')).toContain('127.0.0.1')
  })
})
