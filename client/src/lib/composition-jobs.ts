import type { EditDocument } from './composition-types'

export function hasPendingGeneration(document: EditDocument): boolean {
  return [...(document.before ?? []), ...(document.after ?? []), ...(document.jobs ?? [])]
    .some((job) => !job.resultAssetId && !job.resultTextIds?.length)
}
