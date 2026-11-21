export type JobSummary = {
  id: string
  kind: string
  status: 'queued' | 'claimed' | 'running' | 'completed' | 'failed' | 'cancelled'
  progress: number
  message?: string
  createdAt: string
  updatedAt: string
  filename?: string
  file?: string
  cost?: { status: 'pending' | 'final'; knownCredits: number }
  stage?: { name: string; index?: number; count?: number; completed?: number; total?: number }
  timing?: { approximate: true; basis: string; elapsedSeconds?: number; remainingSeconds?: number; stageRemainingSeconds?: number; stageBasis?: string; estimatedQueueSeconds?: number; jobsAhead?: number }
}

export function activeJob(job: JobSummary): boolean {
  return ['queued', 'claimed', 'running'].includes(job.status)
}

export function downloadableJob(job: JobSummary): boolean {
  return job.status === 'completed' && ['render', 'editor-render', 'automation-render'].includes(job.kind) && Boolean(job.filename || job.file)
}

function durationLabel(seconds: number): string {
  if (seconds < 60) return 'less than a minute'
  const minutes = Math.ceil(seconds / 60)
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} hr ${minutes % 60} min`
}

export function jobWaitLabel(job: JobSummary): string {
  if (!activeJob(job)) return ''
  const sceneRemaining = job.timing?.stageRemainingSeconds
  if (job.stage?.name === 'capture' && typeof sceneRemaining === 'number' && Number.isFinite(sceneRemaining) && sceneRemaining >= 0) {
    return `About ${durationLabel(sceneRemaining)} for this scene’s frames (not the full export)`
  }
  const remaining = job.timing?.remainingSeconds
  if (typeof remaining === 'number' && Number.isFinite(remaining) && remaining >= 0) return `About ${durationLabel(remaining)} remaining`
  const queued = job.timing?.estimatedQueueSeconds
  if (typeof queued === 'number' && Number.isFinite(queued) && queued >= 0) return `About ${durationLabel(queued)} before processing`
  return job.status === 'running' ? 'Estimating completion time — no reliable estimate yet' : 'Waiting for an available worker'
}

export function jobKindLabel(kind: string): string {
  return ({ render: 'Video export', 'editor-render': 'Editor export', 'automation-render': 'Recipe export',
    'ai-scene': 'Animated scene', 'ai-image': 'Image generation', 'ai-speech': 'Speech generation',
    'ai-subtitles': 'Captions', 'compile-generate': 'Recipe assets', 'ai-edit': 'AI edit', 'ai-composition': 'AI composition' })[kind] ?? 'Server job'
}

export function jobProgress(job: JobSummary): number {
  return Number.isFinite(job.progress) ? Math.round(Math.max(0, Math.min(1, job.progress)) * 100) : 0
}

export function sortJobs(jobs: JobSummary[]): JobSummary[] {
  return [...jobs].sort((a, b) => Number(activeJob(b)) - Number(activeJob(a)) || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id))
}

export function safeDownloadURL(value: string): string {
  const url = new URL(value)
  if (url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) {
    throw new Error('The server returned an invalid download link.')
  }
  return url.href
}
