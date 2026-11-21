export function formatSeconds(value: number): string {
  return `${Math.max(0, value).toFixed(2)}s`
}

export function formatTimelineDuration(value: number): string {
  const tenths = Math.round(Math.max(0, value) * 10)
  if (tenths < 600) return `${(tenths / 10).toFixed(1)}s`

  const minutes = Math.floor(tenths / 600)
  const seconds = ((tenths % 600) / 10).toFixed(1).padStart(4, '0')
  return `${minutes}m ${seconds}s`
}

export function formatTimecode(time: number, fps: number): string {
  if (!Number.isFinite(time)) return '00:00:00:00'
  const pad = (value: number, length = 2): string => value.toString().padStart(length, '0')
  return `${pad(Math.floor(time / 3600))}:${pad(Math.floor(time / 60) % 60)}:${pad(Math.floor(time) % 60)}:${pad(Math.floor((time % 1) * fps))}`
}
