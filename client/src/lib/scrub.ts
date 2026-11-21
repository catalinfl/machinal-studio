import { getScrubProxy } from './api'
import { readVideoMetadata } from './video-metadata'
import { scrubSettings, type ScrubMode } from '../stores/scrub.svelte'
import type { ProjectAspect } from '../stores/editor.svelte'

export interface ScrubResult {
  blobUrl: string
  duration: number
}

async function createLocalScrub(input: Blob | File): Promise<ScrubResult> {
  const blobUrl = URL.createObjectURL(input)
  try {
    const metadata = await readVideoMetadata(input)
    return { blobUrl, duration: metadata.duration }
  } catch (cause) {
    try { URL.revokeObjectURL(blobUrl) } catch {}
    throw cause
  }
}

export async function generateScrub(
  fileName: string,
  localFile?: File,
  mode: ScrubMode = scrubSettings.mode,
  aspect: ProjectAspect = 'landscape',
): Promise<ScrubResult> {
  if (mode === 'proxy') return getScrubProxy(fileName, aspect)

  if (!localFile) throw new Error(`Local source is unavailable for ${fileName}`)
  // aspect is intentionally ignored: passthrough keeps original dimensions,
  // exactly like the server passthrough fast path.
  return createLocalScrub(localFile)
}
